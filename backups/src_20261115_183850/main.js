import { Game } from './game.js';
import { SEED, ROUND, WEAPON, PLAYER, ENEMY } from './config.js';

/**
 * Entry point. Builds the game, runs one rAF loop, and exposes a small
 * read-only debug surface on window.__fps so the build can be inspected
 * (and screenshotted) without touching internals.
 */
const canvas = document.getElementById('view');
const game = new Game(canvas);

let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  // Clamp dt: tab switches and hitches must not teleport bodies through walls.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  game.update(dt);
}

requestAnimationFrame(frame);

// Deterministic, testable surface for verification.
window.__fps = {
  version: 1,
  seed: SEED,
  config: { ROUND, WEAPON, PLAYER, ENEMY },
  game,
  start: () => game.start(),
  state: () => ({
    state: game.state,
    result: game.result,
    health: game.player.health,
    mag: game.weapon.mag,
    reserve: game.weapon.reserve,
    timeLeft: game.timeLeft,
    score: game.score,
    kills: game.kills,
    wave: game.wave,
    enemies: game.enemies.length,
    aliveEnemies: game.enemies.filter((e) => e.alive).length,
    shots: game.weapon.shotsFired,
    hits: game.weapon.shotsHit,
    headshots: game.weapon.headshots,
    frames: game.frameCount,
    position: { x: +game.player.position.x.toFixed(3), z: +game.player.position.z.toFixed(3) },
    speed: +game.player.speed.toFixed(3),
    spreadDeg: +((game.weapon.currentSpread(game.player) * 180) / Math.PI).toFixed(3),
  }),
  teleport: (x, z, yaw = game.player.yaw) => {
    game.player.position.set(x, 0, z);
    game.player.velocity.set(0, 0);
    game.player.yaw = yaw;
  },
  aimAt: (x, z, y) => {
    const p = game.player;
    const dx = x - p.position.x;
    const dz = z - p.position.z;
    const dy = (y ?? 1.6) - p.eyeHeight;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p._recoilPitch = 0;
    p._recoilYaw = 0;
  },
  fire: () => {
    if (game.state !== 'playing') return null;
    const res = game.weapon.fire(game.player, game.enemies, game.arena.colliders);
    game.handleFireResult(res);
    return {
      hit: res.hit,
      part: res.part ?? null,
      damage: res.damage ? +res.damage.toFixed(2) : 0,
      killed: !!res.killed,
      mag: game.weapon.mag,
    };
  },
  setCrouch: (v) => { game.input.crouch = v; },
  setMove: (forward = 0, right = 0) => {
    game.input.forward = forward > 0;
    game.input.back = forward < 0;
    game.input.right = right > 0;
    game.input.left = right < 0;
  },
  spawnPoint: (x, z) => {
    const { Enemy } = game.__EnemyCtor;
    const e = new Enemy(game.rng, { x, z }, 99);
    game.scene.add(e.mesh);
    game.enemies.push(e);
    return e.id;
  },
  stats: () => game.weapon.debugStats(game.player),
  hud: () => ({
    health: document.getElementById('health-value').textContent,
    mag: document.getElementById('ammo-mag').textContent,
    reserve: document.getElementById('ammo-reserve').textContent,
    timer: document.getElementById('timer-value').textContent,
    score: document.getElementById('score-value').textContent,
    overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
    overlayTitle: document.getElementById('overlay-title').textContent,
    crosshairSpreadPx: document.getElementById('crosshair').querySelector('i').style.top,
  }),
};

// Handy for the debug helper without exporting the class twice.
import('./enemy.js').then((m) => { game.__EnemyCtor = m; });

console.info('[BLACKSITE RANGE] ready — seed', SEED.toString(16));
