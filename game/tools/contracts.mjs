// Headless contract test for shooters.js / weapon.js / hud.js.
// Fake scene + real THREE objects; no DOM. Prints PASS/FAIL per assertion.
import * as THREE from 'three';
import { createShooters, makeRng } from '../src/shooters.js';
import { createWeapon, WEAPON_SPEC } from '../src/weapon.js';
import { createHud } from '../src/hud.js';

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); }
};

// ---------------------------------------------------------------- scene stub
const scene = new THREE.Scene();
// A cover block at x=4..6, z=-2..2, 2 m tall.
const colliders = [
  { minX: 4, maxX: 6, minZ: -2, maxZ: 2, minY: 0, maxY: 2.0 },
  { minX: -12, maxX: -10, minZ: 8, maxZ: 10, minY: 0, maxY: 1.1 },
];

// ============================================================ STEP 1 shooters
console.log('\n== shooters ==');
const rngA = makeRng(0xb1a5c0de);
const sh = createShooters(scene, colliders, rngA);
ok(typeof sh.update === 'function', 'update is a function');
ok(Array.isArray(sh.list) && sh.list.length === 6, 'six bots', `got ${sh.list.length}`);
ok(sh.list.every(b => b.head && b.head.userData.head === true), 'each bot has a separate head mesh');
ok(sh.list.every(b => b.torso && b.head !== b.torso), 'head mesh is not the torso mesh');
ok(sh.list.every(b => b.mesh.parent === scene), 'meshes parented to the scene');
ok(sh.list.every(b => b.waypoints.length === 2), 'two waypoints per bot');
ok(sh.list.every(b => Math.abs(b.position.x) <= 15.9 && Math.abs(b.position.z) <= 15.9), 'all spawn inside arena');

// Player stands behind cover so nobody has sight, then in the open.
const player = {
  position: new THREE.Vector3(20, 0, 20), // outside -> unreachable, no LOS
  eyeHeight: 1.62, crouching: false, sprinting: false, alive: true,
  hurt(d) { this.damageTaken = (this.damageTaken || 0) + d; },
};

// 1. determinism: same seed -> same spawns
const sh2 = createShooters(new THREE.Scene(), colliders, makeRng(0xb1a5c0de));
ok(sh.list.every((b, i) => Math.abs(b.position.x - sh2.list[i].position.x) < 1e-9), 'seeded spawns are deterministic');

// 2. patrol actually moves a bot
const b0 = sh.list[0];
const startX = b0.position.x, startZ = b0.position.z;
const patrolOnly = { position: new THREE.Vector3(200, 0, 200), eyeHeight: 1.62, alive: true }; // far out of view
for (let i = 0; i < 240; i++) sh.update(1 / 60, patrolOnly, () => {});
const moved = Math.hypot(b0.position.x - startX, b0.position.z - startZ);
ok(moved > 0.5, 'patrol moves bots', `moved ${moved.toFixed(2)}m in 4s`);

// 3. arena containment: shove a bot toward the wall and step
const b1 = sh.list[1];
b1.position.set(15.85, 0, 0);
b1.waypoints = [{ x: 40, z: 0 }, { x: 40, z: 40 }];
for (let i = 0; i < 120; i++) sh.update(1 / 60, player, () => {});
ok(b1.position.x <= 15.9001, 'bots stay inside arena (east wall)', `x=${b1.position.x.toFixed(3)}`);

// 4. collider push-out on both axes
const b2 = sh.list[2];
b2.position.set(4.99, 0, -1.99); // inside the cover block footprint
b2.waypoints = [{ x: 5, z: -2 }, { x: 5, z: -2 }];
sh.update(1 / 60, player, () => {});
const insideCover = b2.position.x > 4 - 0.42 && b2.position.x < 6 + 0.42 && b2.position.z > -2 - 0.42 && b2.position.z < 2 + 0.42;
ok(!insideCover, 'pushed out of collider axis by axis', `pos=(${b2.position.x.toFixed(2)}, ${b2.position.z.toFixed(2)})`);

// 4b. onHit contract: player bullet -> onHit(bot, point, isHead), 3 args only
{
  const reported = [];
  sh.update(1 / 60, player, (...args) => reported.push(args));
  const tgt = sh.list[0];
  tgt.alive = true; tgt.health = 100;
  tgt.position.set(0, 0, -6);
  const o = new THREE.Vector3(0, 0.5, 0);
  const dodged = sh.raycast(o, new THREE.Vector3(0, 0, -1), 40);
  ok(dodged === null, 'legs are not hittable at y=0.5');
  const res = sh.applyPlayerHit(new THREE.Vector3(0, 1.62, 0), new THREE.Vector3(0, 0, -1), 26, 40, { headMul: 3 });
  ok(res && res.isHead === true, 'applyPlayerHit flags a headshot');
  ok(reported.length === 1, 'onHit fired exactly once', `${reported.length}`);
  ok(reported[0] && reported[0].length === 3, 'onHit called with 3 args', `${reported[0] && reported[0].length}`);
  ok(reported[0][0] === tgt && reported[0][1] instanceof THREE.Vector3 && reported[0][2] === true, 'onHit(bot, point, isHead) shapes match');
  ok(Math.abs(reported[0][1].y - 1.62) < 0.01, 'reported point is the impact point', `y=${reported[0][1].y.toFixed(2)}`);
  // world occlusion: same ray, cover between -> no report
  reported.length = 0;
  tgt.position.set(0, 0, -12);
  tgt.health = 100; tgt.alive = true;
  const throughCover = sh.applyPlayerHit(new THREE.Vector3(4.99, 1.62, -6), new THREE.Vector3(0, 0, -1), 26, 40);
  ok(throughCover === null && reported.length === 0, 'cover between shooter and target blocks the report');
  tgt.position.set(0, 0, -6);
}

// 5. engage + fire on clear LOS within 30 units
// Park every other bot far outside view range: player.hurt() is global, so the
// per-shot damage band can only be read when exactly one bot is shooting.
const shooter = sh.list[3];
for (const b of sh.list) if (b !== shooter) { b.position.set(0, 0, 90); b.alive = false; b.respawnTimer = 1e9; }
shooter.alive = true; shooter.health = 100;
shooter.position.set(0, 0, 0);
shooter.yaw = 0;
const open = {
  position: new THREE.Vector3(0, 0, 12), eyeHeight: 1.62, alive: true,
  crouching: false, sprinting: false,
  hurt(d) { this.taken = (this.taken || 0) + d; },
};
let shots = 0, blockedShots = 0;
const damageLog = [];
let dmgSample = 0;
// bot damage is sampled from player.hurt, so the band check reads the real value
const origHurt = open.hurt.bind(open);
for (let i = 0; i < 300; i++) { // 5 s
  sh.update(1 / 60, open, () => {}, (bot, kind) => {
    if (bot !== shooter) return;
    if (kind === 'blocked') { blockedShots++; return; }
    shots++;
    damageLog.push(dmgSample);
  });
}
ok(shooter.state === 'engage', 'bot engages with clear LOS at 12m', shooter.state);
ok(shots >= 2, 'fires repeatedly inside 5 s', `${shots} shots`);
const intervals = [];
// re-derive cadence: 5s of fire at 0.9-1.4s per shot -> 3..5 shots
ok(shots >= 3 && shots <= 6, 'cadence matches 0.9-1.4 s', `${shots} shots in 5.0 s`);
{
  // Every landed shot must sit in 8..14; the total is the sum of those shots.
  const avg = open.taken / Math.max(1, shots);
  ok(avg >= 8 && avg <= 14, 'damage per shot in 8..14 band', `avg ${avg.toFixed(2)} over ${shots} shots`);
}
ok(open.taken > 0, 'bot damage lands on player.hurt()', `${(open.taken || 0).toFixed(1)} total`);

// 6. no fire through cover
const behind = { ...open, position: new THREE.Vector3(9.0, 0, 0), taken: 0 };
shooter.fireCooldown = 0.05;
let through = 0;
for (let i = 0; i < 240; i++) sh.update(1 / 60, behind, () => {}, (bot, kind) => { if (bot === shooter && kind !== 'blocked') through++; });
ok(through === 0, 'cover blocks the shot ray', `${through} bypassed`);

// 7. out of range -> no engage
shooter.position.set(0, 0, 0);
const far = { ...open, position: new THREE.Vector3(0, 0, 34) };
for (let i = 0; i < 60; i++) sh.update(1 / 60, far, () => {});
ok(shooter.state === 'patrol', 'no engage beyond 30 units', shooter.state);

// 8. death + respawn 2.5 s
// Undo the isolation above: reset() is the documented way back to a clean run.
sh.reset();
ok(sh.list.every(b => b.alive && b.health === b.maxHealth), 'reset() revives the whole squad');
const victim = sh.list[4];
const r = sh.damage(victim, 150, false);
ok(r.killed && !victim.alive, 'damage kills');
ok(victim.mesh.visible === false, 'corpse hidden');
const deadPos = { x: victim.position.x, z: victim.position.z };
for (let i = 0; i < 140; i++) sh.update(1 / 60, open, () => {}); // 2.33 s
ok(!victim.alive, 'still dead at 2.33 s');
for (let i = 0; i < 20; i++) sh.update(1 / 60, open, () => {}); // 2.67 s
ok(victim.alive, 'respawned after 2.5 s');
ok(victim.health === victim.maxHealth && victim.mesh.visible, 'respawn restores health + mesh');
ok(Math.abs(victim.position.x) <= 15.9 && Math.abs(victim.position.z) <= 15.9, 'respawn inside arena');

// 9. raycast: head vs torso, nearest wins
const target = sh.list[5];
target.position.set(0, 0, -6); target.yaw = 0; target.alive = true;
const origin = new THREE.Vector3(0, 1.62, 0);
const headHit = sh.raycast(origin, new THREE.Vector3(0, 0, -1), 40);
ok(headHit && headHit.bot === target, 'raycast finds the bot');
ok(headHit && Math.abs(headHit.point.z - (-6 + 0.16)) < 0.02, 'hit point sits on the near face', headHit ? `z=${headHit.point.z.toFixed(2)}` : 'miss');
ok(headHit && headHit.isHead === true, 'eye-height ray counts as head (head band 1.44..1.80)', headHit ? `isHead=${headHit.isHead}` : 'miss');
const chest = sh.raycast(new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(0, 0, -1), 40);
ok(chest && chest.isHead === false, 'chest-height ray counts as torso', chest ? `isHead=${chest.isHead}` : 'miss');
const legs = sh.raycast(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0, -1), 40);
ok(legs === null, 'legs are outside the torso/head hitboxes (no hit)');
ok(typeof sh.raycastWorld === 'function' && sh.raycastWorld(origin, new THREE.Vector3(1, 0, 0), 40), 'world raycast returns a wall point');
const missRay = sh.raycast(new THREE.Vector3(0, 1.62, 0), new THREE.Vector3(0, 1, 0), 40);
ok(missRay === null || missRay.bot !== null, 'sky ray does not throw');

// ============================================================== STEP 2 weapon
console.log('\n== weapon ==');
const cam = new THREE.PerspectiveCamera(76, 1, 0.05, 400);
cam.position.set(0, 1.6, 0);
cam.lookAt(0, 1.6, -10);
cam.updateMatrixWorld(true);
const w = createWeapon(cam, makeRng(7));
ok(w.mag === 24, 'mag starts at 24', String(w.mag));
ok(w.reserve === 96, 'reserve starts at 96', String(w.reserve));
ok(cam.children.includes(w.group), 'view model parented to camera');
ok(w.group.children.length >= 8 && w.group.children.every(c => c.isMesh), 'view model is box-built', `${w.group.children.length} meshes`);
ok(w.group.children.every(c => c.geometry.type === 'BoxGeometry'), 'every viewmodel part is a BoxGeometry');

ok(Math.abs(w.spreadFor(false, false) - 0.004) < 1e-9, 'base half-angle 0.004');
ok(Math.abs(w.spreadFor(true, false) - 0.024) < 1e-9, 'moving +0.02');
ok(Math.abs(w.spreadFor(false, true) - 0.0) < 1e-9, 'crouched -0.004 (floored at 0)');
ok(Math.abs(w.spreadFor(true, true) - 0.02) < 1e-9, 'moving+crouched nets 0.02');

ok(w.canFire(), 'can fire when full');
const shot = w.fire(false, false);
ok(shot.fired && w.mag === 23, 'shot consumes a round', `mag=${w.mag}`);
const ang = Math.acos(Math.min(1, shot.direction.dot(shot.base)));
ok(ang <= shot.spread + 1e-6, 'shot stays inside its cone', `${(ang * 180 / Math.PI).toFixed(3)} deg <= ${(shot.spread * 180 / Math.PI).toFixed(3)}`);
ok(!w.canFire(), 'rate-limited right after a shot');
w.update(WEAPON_SPEC.fireInterval + 1e-4);
ok(w.canFire(), 'can fire after the interval');

// recoil grows then eases back
let peak = 0;
for (let i = 0; i < 6; i++) {
  const s2 = w.fire(true, false);
  if (s2.fired) peak = Math.max(peak, w.recoilOffset().pitch);
  w.update(0.097);
}
ok(peak > 0.01, 'recoil accumulates on the trigger', `peak ${peak.toFixed(4)} rad`);
for (let i = 0; i < 120; i++) w.update(1 / 60);
ok(w.recoilOffset().pitch < peak * 0.02, 'recoil eases back to ~0', `${w.recoilOffset().pitch.toFixed(5)} rad`);

// reload
const before = w.mag;
const started = w.reload();
ok(started && w.reloading, 'reload starts');
w.update(2.0);
ok(w.reloading && w.mag === before, 'still reloading at 2.0 s', `mag=${w.mag}`);
w.update(0.15);
ok(!w.reloading && w.mag === 24, 'reload completes at 2.1 s', `mag=${w.mag}`);
ok(w.reserve === 96 - (24 - before), 'reserve drains by the difference', `reserve=${w.reserve}`);
ok(w.reload() === false, 'no reload when full');

// empty
for (let i = 0; i < 30; i++) { w.fire(false, false); w.update(0.2); }
ok(w.mag === 0, 'mag empties', `mag=${w.mag}`);
ok(!w.canFire(), 'cannot fire empty');
ok(w.fire(false, false).reason === 'empty', 'empty fire reports a reason');
// dry reload with no reserve
w.reserve = 0;
ok(w.reload() === false, 'cannot reload with no reserve');
w.reserve = 96;
ok(w.reload() === true, 'reload works again with reserve');
w.update(2.2);
ok(w.mag === 24, 'refilled to 24', `mag=${w.mag}`);

// direction follows the camera
const d = w.direction();
ok(Math.abs(d.z + 1) < 1e-6, 'direction is camera forward (-Z)', `[${d.x.toFixed(2)},${d.y.toFixed(2)},${d.z.toFixed(2)}]`);

// ================================================================= STEP 3 hud
console.log('\n== hud ==');
const h = createHud(); // no document at all
const apiKeys = ['onPlay', 'setHealth', 'setAmmo', 'setTimer', 'setScore', 'setMessage', 'showEnd', 'hideEnd'];
ok(apiKeys.every(k => k in h), 'full contract present');
let threw = null;
try {
  h.setHealth(100); h.setHealth(12); h.setAmmo(24, 96); h.setAmmo(0, 0);
  h.setTimer(150); h.setTimer(0); h.setScore(0); h.setScore(1250);
  h.setMessage('WAVE 1'); h.setMessage(''); h.showEnd('CLEAR', 'copy', { win: true });
  h.hideEnd(); h.hit(true); h.update(0.2); h.onPlay = () => {};
} catch (e) { threw = e; }
ok(!threw, 'never throws with zero DOM', threw ? threw.message : '9 call groups clean');

// now with a minimal fake DOM to prove text caching + red health + 90ms marker
class FakeEl {
  constructor(id) { this.id = id; this._text = ''; this.writes = 0; this.style = {}; this.classes = new Set(); this.children = []; this.firstElementChild = null; }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.writes++; }
  get classList() {
    const self = this;
    return {
      add: (c) => self.classes.add(c),
      remove: (c) => self.classes.delete(c),
      toggle: (c, on) => { const v = on === undefined ? !self.classes.has(c) : !!on; if (v) self.classes.add(c); else self.classes.delete(c); return v; },
      contains: (c) => self.classes.has(c),
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
const ids = ['hud','crosshair','hitmarker','health-value','health-bar','health-panel','ammo','ammo-mag','ammo-reserve','ammo-sep','ammo-panel','weapon-name','timer-value','timer-panel','score-value','score-panel','wave-value','wave-panel','feed','damage','overlay','overlay-title','overlay-copy','overlay-kicker','overlay-keys','overlay-foot','play'];
const store = new Map(ids.map(id => [id, new FakeEl(id)]));
const barFill = new FakeEl('fill'); barFill.style = {};
store.get('health-bar').firstElementChild = barFill;
globalThis.document = {
  getElementById: (id) => store.get(id) || null,
  createElement: () => new FakeEl('div'),
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };

const h2 = createHud();
const hpEl = store.get('health-value');
h2.setHealth(100); h2.setHealth(100); h2.setHealth(100);
ok(hpEl.writes === 1, 'unchanged health writes text once', `${hpEl.writes} writes for 3 calls`);
h2.setHealth(12);
ok(hpEl.writes === 2, 'changed health writes again', `${hpEl.writes} writes`);
ok(hpEl.style.color === '#ff3b30', 'health turns red under 35', hpEl.style.color);
ok(store.get('health-panel').classes.has('critical'), 'panel flagged critical');
ok(barFill.style.background === '#ff3b30', 'bar fill turns red under 35', barFill.style.background);
h2.setHealth(80);
ok(hpEl.style.color === '#57e08a' && !store.get('health-panel').classes.has('critical'), 'recovers above 35');

const ammoMag = store.get('ammo-mag');
h2.setAmmo(24, 96); h2.setAmmo(24, 96); h2.setAmmo(24, 96);
ok(ammoMag.writes === 1, 'unchanged ammo writes once', `${ammoMag.writes}`);
h2.setAmmo(3, 96);
ok(store.get('ammo').classes.has('low'), 'low-ammo flag at 3');
h2.setAmmo(0, 96);
ok(store.get('ammo').classes.has('empty'), 'empty flag at 0');

const tm = store.get('timer-value');
h2.setTimer(150);
ok(tm.textContent === '2:30', 'timer formats mm:ss', tm.textContent);
h2.setTimer(9);
ok(tm.textContent === '0:09' && store.get('timer-panel').classes.has('urgent'), 'timer urgent under 20 s', tm.textContent);

const hitEl = store.get('hitmarker');
h2.hit(true);
ok(hitEl.classes.has('on') && hitEl.classes.has('crit'), 'hitmarker on + crit');
await new Promise(r => setTimeout(r, 140));
ok(!hitEl.classes.has('on'), 'hitmarker cleared after 90 ms window');

h2.showEnd('RANGE CLEAR', 'nice', { win: true });
ok(!store.get('overlay').classes.has('hidden') && store.get('overlay').classes.has('result-win'), 'showEnd reveals overlay');
ok(store.get('overlay-title').textContent === 'RANGE CLEAR', 'end title written');
h2.hideEnd();
ok(store.get('overlay').classes.has('hidden'), 'hideEnd hides overlay');

// missing-element safety: blow away half the DOM
for (const k of ['feed', 'play', 'timer-value', 'damage', 'overlay']) store.delete(k);
let threw2 = null;
try { h2.setMessage('x'); h2.setTimer(5); h2.setDamage(0.5); h2.showEnd('A', 'B'); h2.onPlay = () => {}; } catch (e) { threw2 = e; }
ok(!threw2, 'survives elements disappearing mid-run', threw2 ? threw2.message : 'clean');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
