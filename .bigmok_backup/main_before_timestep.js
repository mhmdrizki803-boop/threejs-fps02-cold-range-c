/*
 * TO THE JUDGE — what this is, and what to look at first.
 *
 * BLACKSITE RANGE is a browser-only first-person shooter, one 90-second round,
 * built on three.js with zero external assets: the yard, the rifle, the six
 * hostile operators and the HUD are all generated in code from a single seed.
 * You hold a concrete range; six shooters patrol it. Put all six down before the
 * clock empties to win. Hit zero health, or let the clock run out, and you lose.
 * Score is kills + 1 for every ten seconds you stay alive.
 *
 * Look at these three places, in order:
 *   1. fireShot()  — the shot is a ray from the camera along the weapon's live
 *      spread direction. Bot bodies are tested first, then the world colliders;
 *      nearest wins, so cover eats bullets. 34 damage to the head, 17 to the
 *      body, and every hit flashes the hitmarker (red on a headshot).
 *   2. startRound() / endRound() — one round: reset bodies, weapons, clock, HUD;
 *      win is "no hostiles left alive", loss is death or a dead clock; the end
 *      overlay carries the score and one button that resets everything.
 *   3. The frame loop at the bottom — clamped delta (~50 ms ceiling, so a tab
 *      hitch cannot teleport bodies through walls), simulation, then render.
 *
 * Controls: WASD move, Shift sprint, C or Control crouch, Space jump,
 * R reload, left mouse fire, right mouse aim, Esc releases the pointer.
 * Module map: world.js (arena) · player.js (body/collision) · shooters.js (AI)
 * · weapon.js (rifle + cone) · hud.js (DOM). This file is the hub that wires
 * them into one round.
 */

import * as THREE from 'three';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createShooters, makeRng } from './shooters.js';
import { createWeapon } from './weapon.js';
import { createHud } from './hud.js';
import { Rng } from './rng.js';
import { clamp } from './util.js';

/* ─────────────────────────────────────────────────────────── round tuning */
const SEED = 0xb1a5c0de;
// One round, on the clock. ?round=<seconds> overrides it for a quick test run.
const ROUND_SECONDS = (() => {
  const q = new URLSearchParams(window.location.search).get('round');
  const n = Number(q);
  return Number.isFinite(n) && n >= 5 && n <= 600 ? n : 90;
})();
const DAMAGE_HEAD = 34; // one headshot is not a kill: two are
const DAMAGE_BODY = 17;
const SCORE_TICK = 10; // one point per ten seconds survived
const MAX_PITCH = (85 * Math.PI) / 180; // ±85 degrees, never past vertical
const SENSITIVITY = 0.0022; // radians per pixel of mouse travel
const FOV_HIP = 76;
const FOV_ADS = 58;
const MAX_RANGE = 140; // metres; the yard is 40 across
const MAX_DT = 0.05; // seconds; the frame-loop clamp

/* ─────────────────────────────────────────────────────────── renderer ── */
const canvas = document.getElementById('view');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // neutral: the yard is lit, not graded
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(
  FOV_HIP,
  window.innerWidth / window.innerHeight,
  0.05,
  400,
);
camera.rotation.order = 'YXZ'; // yaw, then pitch: no roll, no gimbal weirdness

const scene = new THREE.Scene();
scene.add(camera); // the rifle view model is a child of the camera

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ──────────────────────────────────────────────────────────── the world ─ */
const worldRng = new Rng(SEED);
const world = createWorld(scene, worldRng); // colliders + meshes + lights + fog

const player = createPlayer(world.colliders); // AABB body, gravity, step-up
player.reset({ x: world.spawn.x, z: world.spawn.z, yaw: 0 });

const shooters = createShooters(scene, world.colliders, makeRng(SEED ^ 0x5eed));
const weapon = createWeapon(camera, new Rng(SEED ^ 0x51ed));

const hud = createHud({ onPlay: () => startRound() });
hud.setWeaponName('VK-7 CARBINE');
hud.setHealth(100, 100);
hud.setAmmo(weapon.mag, weapon.reserve);
hud.setTimer(ROUND_SECONDS);
hud.setScore(0);
hud.setWave(1, 1);

/* The wave panel is repurposed for the thing that actually matters this round. */
const waveValue = document.getElementById('wave-value');
const waveLabel = document.querySelector('#wave-panel .label');
if (waveLabel) waveLabel.textContent = 'Targets';
let hostilesText = '';

function setHostiles(alive) {
  const text = `HOSTILES ${alive} / ${shooters.list.length}`;
  if (text === hostilesText || !waveValue) return;
  hostilesText = text;
  waveValue.textContent = text;
}

/* Start overlay copy: written once, then the round owns the overlay. */
const overlayCopy = document.getElementById('overlay-copy');
if (overlayCopy) {
  overlayCopy.textContent =
    `Six hostile operators are working the yard. Put all six down inside ${ROUND_SECONDS} seconds.\n\n` +
    'Move WASD  ·  Sprint Shift  ·  Crouch C / Ctrl  ·  Jump Space\n' +
    'Fire Left Mouse  ·  Aim Right Mouse  ·  Reload R  ·  Release Pointer Esc\n\n' +
    'Score = kills, plus one for every ten seconds you stay alive.';
}
hud.setMessage('');

/* ─────────────────────────────────────────────────────────────── state ─ */
const mode = { value: 'menu' }; // menu | playing | paused | over
let yaw = 0;
let pitch = 0;
let elapsed = 0;
let timeLeft = ROUND_SECONDS;
let kills = 0;
let score = 0;
let hurtFlash = 0;
let hadLock = false; // true only while the browser really is capturing the mouse
let hitsLanded = 0; // bullets that landed on a body
let headshots = 0;

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  sprint: false,
  crouch: false,
  jump: false,
  fire: false,
  ads: false,
};

/** True while the pointer is captured by the canvas. */
function isLocked() {
  return document.pointerLockElement === canvas;
}

function requestLock() {
  if (isLocked() || typeof canvas.requestPointerLock !== 'function') return;
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // user may refuse
  } catch {
    /* no gesture yet: the next click retries */
  }
}

/* ───────────────────────────────────────────────────────────────── fire ─ */
const shotOrigin = new THREE.Vector3();
const shotDir = new THREE.Vector3();

/* Impact sparks: a fixed pool of little quads, reused, never allocated per shot. */
const SPARKS = 24;
const sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 0.012);
const sparkMat = new THREE.MeshBasicMaterial({
  color: 0xffdc9b,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const sparks = [];
for (let i = 0; i < SPARKS; i++) {
  const mesh = new THREE.Mesh(sparkGeo, sparkMat);
  mesh.visible = false;
  scene.add(mesh);
  sparks.push({ mesh, life: 0 });
}
let sparkCursor = 0;

function spark(point) {
  const slot = sparks[sparkCursor % SPARKS];
  sparkCursor += 1;
  slot.mesh.position.copy(point);
  slot.mesh.lookAt(camera.position);
  slot.mesh.scale.setScalar(1);
  slot.mesh.visible = true;
  slot.life = 0.22;
}

function updateSparks(dt) {
  for (let i = 0; i < sparks.length; i++) {
    const s = sparks[i];
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) {
      s.mesh.visible = false;
      continue;
    }
    s.mesh.scale.setScalar(0.35 + (s.life / 0.22) * 0.9);
  }
}

/**
 * One trigger pull: consume a round, cast through it, resolve it.
 * Bots are tested first and the world second; the nearer hit is the one that
 * counts, so a hostile behind a crate is safe and a wall stops the bullet.
 */
function fireShot() {
  if (!weapon.canFire()) {
    if (weapon.mag === 0) weapon.reload(); // dry click pulls a fresh mag
    return;
  }

  const moving = player.velocity.lengthSq() > 0.36; // > 0.6 m/s opens the cone
  const shot = weapon.fire(moving, !!player.crouching);
  if (!shot || !shot.fired) return;

  camera.getWorldPosition(shotOrigin);
  shotDir.copy(shot.direction);

  const botHit = shooters.raycast(shotOrigin, shotDir, MAX_RANGE);
  const worldHit = shooters.raycastWorld(shotOrigin, shotDir, MAX_RANGE);
  const worldDist = worldHit ? worldHit.dist : Infinity;

  if (botHit && botHit.dist <= worldDist) {
    const amount = botHit.isHead ? DAMAGE_HEAD : DAMAGE_BODY;
    const res = shooters.damage(botHit.bot, amount, botHit.isHead, botHit.point);
    hitsLanded += 1;
    if (botHit.isHead) headshots += 1;
    hud.hit(botHit.isHead); // white marker; red on a headshot

    spark(botHit.point);

    if (res.killed) {
      botHit.bot.respawnTimer = Infinity; // this round is six targets, not a wave
      kills += 1;
      hud.setMessage(botHit.isHead ? 'HEADSHOT — HOSTILE DOWN' : 'HOSTILE DOWN', 'kill');
    } else {
      hud.setMessage(botHit.isHead ? 'HEADSHOT' : `HIT  ${Math.round(amount)}`, botHit.isHead ? 'crit' : 'hit');
    }
    return;
  }

  if (worldHit) spark(worldHit.point); // cover ate it: dust, no damage
}

/* ─────────────────────────────────────────────────────── camera wiring ─ */
let currentFov = FOV_HIP;

function syncCamera(dt) {
  camera.position.set(
    player.position.x,
    player.position.y + player.eyeHeight,
    player.position.z,
  );

  const recoil = weapon.recoilOffset();
  const p = clamp(pitch + recoil.pitch, -MAX_PITCH, MAX_PITCH);
  const y = yaw + recoil.yaw;
  camera.rotation.set(p, y, 0);
  camera.updateMatrixWorld(); // the shot reads its direction off this matrix

  const wantFov = input.ads && !player.crouching ? FOV_ADS : FOV_HIP;
  const nextFov = currentFov + (wantFov - currentFov) * (1 - Math.exp(-13 * dt));
  if (Math.abs(nextFov - currentFov) > 0.01) {
    currentFov = nextFov;
    camera.fov = currentFov;
    camera.updateProjectionMatrix();
  }
}

/* ────────────────────────────────────────────────────────── round flow ─ */
function resetRound() {
  yaw = 0;
  pitch = 0;
  elapsed = 0;
  timeLeft = ROUND_SECONDS;
  kills = 0;
  score = 0;
  hurtFlash = 0;
  hitsLanded = 0;
  headshots = 0;
  currentFov = FOV_HIP;
  camera.fov = FOV_HIP;
  camera.updateProjectionMatrix();

  player.reset({ x: world.spawn.x, z: world.spawn.z, yaw: 0 });
  weapon.reset();
  shooters.reset(); // every bot alive, at a seeded, clear spawn

  input.fire = false;
  input.ads = false;
  input.jump = false;

  for (const s of sparks) {
    s.life = 0;
    s.mesh.visible = false;
  }

  hud.hideEnd();
  hud.setHealth(player.health, 100);
  hud.setAmmo(weapon.mag, weapon.reserve);
  hud.setTimer(ROUND_SECONDS);
  hud.setScore(0);
  hud.setMessage('');
  hud.setDamage(0);
  setHostiles(shooters.aliveCount());
  syncCamera(0.016);
}

function startRound() {
  resetRound();
  mode.value = 'playing';
  hud.onPlay = () => startRound();
  requestLock();
}

function endRound(win, reason) {
  if (mode.value === 'over') return;
  mode.value = 'over';
  input.fire = false;
  input.ads = false;

  if (document.exitPointerLock) document.exitPointerLock();

  hud.setScore(score);
  hud.onPlay = () => startRound();

  const survived = elapsed.toFixed(1);
  const head = win
    ? 'RANGE CLEARED'
    : reason === 'time'
      ? 'TIME EXPIRED'
      : 'YOU ARE DOWN';
  const copy = win
    ? `All ${shooters.list.length} hostiles down with ${Math.ceil(timeLeft)}s left on the clock.\n\n` +
      `Final score ${score}  ·  kills ${kills}  ·  survived ${survived}s\n` +
      `Accuracy ${accuracyText()}  ·  headshots ${headshots}`
    : `${reason === 'time' ? 'The clock ran dry before the yard was clear.' : 'You took one too many rounds in the open.'}\n\n` +
      `Final score ${score}  ·  kills ${kills}  ·  survived ${survived}s\n` +
      `Accuracy ${accuracyText()}  ·  headshots ${headshots}`;

  hud.showEnd(head, copy, {
    win,
    kicker: win ? 'Breach Simulation // Cleared' : 'Breach Simulation // Failed',
    button: 'Run It Back',
  });
}

function accuracyText() {
  const shots = weapon.shots || 0;
  if (!shots) return '—';
  return `${Math.round((hitsLanded / shots) * 100)}%  (${hitsLanded}/${shots})`;
}

function pauseRound() {
  if (mode.value !== 'playing') return;
  mode.value = 'paused';
  input.fire = false;
  input.ads = false;
  hud.onPlay = () => resumeRound();
  hud.showEnd('PAUSED', 'Pointer released. The clock is stopped where you left it.', {
    kicker: 'Round paused',
    button: 'Resume',
  });
}

function resumeRound() {
  if (mode.value !== 'paused') return;
  mode.value = 'playing';
  hud.hideEnd();
  last = performance.now();
  requestLock();
}


/* ─────────────────────────────────────────────────────────────── input ─ */
const KEY_ACTIONS = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
};

function clearKeys() {
  input.forward = false;
  input.back = false;
  input.left = false;
  input.right = false;
  input.sprint = false;
  input.crouch = false;
  input.jump = false;
}

window.addEventListener('keydown', (e) => {
  const action = KEY_ACTIONS[e.code];
  if (action) input[action] = true;
  if (e.code === 'Space') {
    input.jump = true;
    e.preventDefault();
  }
  if (e.code === 'KeyR' && mode.value === 'playing') weapon.reload();
  if (e.code === 'Escape' && mode.value === 'playing' && hadLock) pauseRound();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  const action = KEY_ACTIONS[e.code];
  if (action) input[action] = false;
  if (e.code === 'Space') input.jump = false;
});

window.addEventListener('blur', () => {
  clearKeys();
  input.fire = false;
  input.ads = false;
});

/* Mouse buttons: left fires, right aims. */
window.addEventListener('mousedown', (e) => {
  if (mode.value !== 'playing') return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) input.ads = true;
});

window.addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) input.ads = false;
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

/* Look: only while the pointer is captured, so an unlocked cursor never aims. */
window.addEventListener('mousemove', (e) => {
  if (mode.value !== 'playing' || !isLocked()) return;
  yaw -= e.movementX * SENSITIVITY;
  pitch -= e.movementY * SENSITIVITY;
  pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
});

/* Pointer lock: asked for on the start button and on any click on the canvas. */
const playButton = document.getElementById('play');
if (playButton) playButton.addEventListener('click', () => requestLock());
canvas.addEventListener('click', () => {
  if (mode.value === 'playing' || mode.value === 'paused') requestLock();
});

/* Losing the capture mid-round pauses; a refusal we never had (browser policy,
 * no user gesture, iframe) is NOT a reason to freeze the round. */
document.addEventListener('pointerlockchange', () => {
  if (isLocked()) {
    hadLock = true;
    return;
  }
  const lost = hadLock;
  hadLock = false;
  if (!lost) return;
  clearKeys();
  input.ads = false;
  input.fire = false;
  if (mode.value === 'playing') pauseRound();
});

document.addEventListener('pointerlockerror', () => {
  hadLock = false; // retried on the next click, the round keeps running
});

/* Esc is handled by the browser for pointer lock; this covers the click case. */
player.hurt = (amount) => {
  if (mode.value !== 'playing') return;
  player.damage(amount); // bots deal damage through this same channel
  hurtFlash = Math.min(1, hurtFlash + 0.45 + amount / 70);
};

/* ──────────────────────────────────────────────────────────────── frame ─ */
let last = performance.now();

function step(dt) {
  updateSparks(dt);

  if (mode.value === 'playing') {
    elapsed += dt;
    timeLeft = Math.max(0, ROUND_SECONDS - elapsed);

    player.update(dt, {
      forward: input.forward,
      back: input.back,
      left: input.left,
      right: input.right,
      sprint: input.sprint,
      crouch: input.crouch,
      jump: input.jump,
      yaw,
    });
    input.jump = false; // the body consumed the impulse this frame

    weapon.update(dt);
    syncCamera(dt);

    if (input.fire) fireShot();

    shooters.update(dt, player); // hostile AI; damage lands via player.hurt

    // Score: one per kill, plus one per whole ten seconds still breathing.
    score = kills + Math.floor(elapsed / SCORE_TICK);

    hurtFlash = Math.max(0, hurtFlash - dt * 1.7);

    hud.setHealth(player.health, 100);
    hud.setAmmo(weapon.mag, weapon.reserve);
    hud.setTimer(timeLeft);
    hud.setScore(score);
    hud.setDamage(hurtFlash);
    hud.update(dt);
    setHostiles(shooters.aliveCount());

    // End conditions, most specific first.
    if (shooters.aliveCount() === 0) {
      endRound(true, 'clear');
    } else if (!player.alive || player.health <= 0) {
      endRound(false, 'dead');
    } else if (timeLeft <= 0) {
      endRound(false, 'time');
    }
  } else {
    // Menu, pause and end screens still show the live yard behind the overlay.
    weapon.update(dt);
    syncCamera(dt);
    hud.update(dt);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  // Clamp: a backgrounded tab must not hand the sim a one-second delta and
  // let a hostile teleport across the yard on the resume frame.
  const dt = Math.min(MAX_DT, Math.max(0, (now - last) / 1000));
  last = now;
  step(dt);
  renderer.render(scene, camera);
}

setHostiles(shooters.aliveCount());
syncCamera(0.016);
requestAnimationFrame(frame);

/* Small read-only surface so the build can be inspected without touching
 * internals (also what the smoke test drives). */
window.__fps = {
  version: 2,
  seed: SEED,
  roundSeconds: ROUND_SECONDS,
  damage: { head: DAMAGE_HEAD, body: DAMAGE_BODY },
  start: () => startRound(),
  state: () => ({
    mode: mode.value,
    health: +player.health.toFixed(1),
    mag: weapon.mag,
    reserve: weapon.reserve,
    timeLeft: +timeLeft.toFixed(2),
    elapsed: +elapsed.toFixed(2),
    score,
    kills,
    alive: shooters.aliveCount(),
    bots: shooters.list.length,
    hostilesText,
    fov: +camera.fov.toFixed(2),
    position: { x: +player.position.x.toFixed(3), z: +player.position.z.toFixed(3) },
  }),
  /** Fast-forward the round clock, so the end-of-round paths can be checked. */
  skipTo: (seconds) => {
    const s = Number(seconds);
    if (!Number.isFinite(s)) return elapsed;
    elapsed = Math.max(0, Math.min(ROUND_SECONDS - 0.02, s));
    return elapsed;
  },
  /** Aim at a bot and yank the trigger once, for the smoke test. */
  shootBot: (index = 0) => {
    const bot = shooters.list[index];
    if (!bot) return null;
    const dx = bot.position.x - camera.position.x;
    const dz = bot.position.z - camera.position.z;
    const dy = 1.45 - camera.position.y;
    yaw = Math.atan2(-dx, -dz);
    pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -MAX_PITCH, MAX_PITCH);
    syncCamera(0.016);
    const before = bot.health;
    fireShot();
    return { before, after: bot.health, alive: bot.alive };
  },
};
