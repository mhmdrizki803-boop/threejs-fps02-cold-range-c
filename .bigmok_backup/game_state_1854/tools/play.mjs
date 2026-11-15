import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8777/game/index.html';
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__fps);
await page.waitForTimeout(600);

// ---- start a round via the real button ----
await page.click('#play');
await page.waitForTimeout(400);
const started = await page.evaluate(() => ({ ...window.__fps.state(), hud: window.__fps.hud() }));

// ---- let enemies spawn and approach ----
await page.waitForTimeout(2500);
await page.screenshot({ path: 'shot-play.png' });
const afterSpawn = await page.evaluate(() => window.__fps.state());

// ---- spread: standing vs running vs crouched ----
const spreadStand = await page.evaluate(() => window.__fps.state().spreadDeg);
await page.evaluate(() => window.__fps.setMove(1, 0));
await page.waitForTimeout(900);
const spreadRun = await page.evaluate(() => ({ spread: window.__fps.state().spreadDeg, speed: window.__fps.state().speed }));
await page.evaluate(() => { window.__fps.setMove(0, 0); });
await page.waitForTimeout(700);
await page.evaluate(() => window.__fps.setCrouch(true));
await page.waitForTimeout(400);
const spreadCrouch = await page.evaluate(() => window.__fps.state().spreadDeg);
await page.evaluate(() => window.__fps.setCrouch(false));
await page.waitForTimeout(300);

// ---- hitbox test: aim torso vs head at the same range ----
const hitTest = await page.evaluate(async () => {
  const g = window.__fps.game;
  // Clear the field, then place one target 8m in front of a fixed shooter pose.
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  window.__fps.teleport(0, 18, Math.PI);
  const mod = await import('/game/src/enemy.js');
  const mk = () => {
    const e = new mod.Enemy(g.rng, { x: 0, z: 10 }, 1);
    g.scene.add(e.mesh);
    g.enemies.push(e);
    e.mesh.updateMatrixWorld(true);
    return e;
  };
  const out = {};
  // torso shot
  let e = mk();
  window.__fps.aimAt(0, 10, 1.15);
  g.weapon.mag = 24; g.weapon.bloom = 0; g.weapon.cooldown = 0;
  let r = window.__fps.fire();
  out.torso = r;
  // head shot
  e = mk();
  window.__fps.aimAt(0, 10, 1.66);
  g.weapon.mag = 24; g.weapon.bloom = 0; g.weapon.cooldown = 0;
  r = window.__fps.fire();
  out.head = r;
  // leg shot
  e = mk();
  window.__fps.aimAt(0, 10, 0.45);
  g.weapon.mag = 24; g.weapon.bloom = 0; g.weapon.cooldown = 0;
  r = window.__fps.fire();
  out.legs = r;
  // clean miss high above
  e = mk();
  window.__fps.aimAt(0, 10, 4.2);
  g.weapon.mag = 24; g.weapon.bloom = 0; g.weapon.cooldown = 0;
  out.miss = window.__fps.fire();
  return out;
});

// ---- ammo / reload / dry fire ----
const ammo = await page.evaluate(async () => {
  const g = window.__fps.game;
  g.weapon.mag = 2; g.weapon.reserve = 10; g.weapon.reloading = false;
  g.weapon.cooldown = 0; window.__fps.fire(); g.weapon.cooldown = 0; window.__fps.fire();
  const empty = { mag: g.weapon.mag, dryFire: window.__fps.fire() };
  const reloadStarted = g.weapon.startReload();
  // Tick the reload clock forward without waiting 1.7 real seconds.
  for (let i = 0; i < 120; i++) g.weapon.reloadStep(1 / 60);
  return { empty, reloadStarted, after: { mag: g.weapon.mag, reserve: g.weapon.reserve, reloading: g.weapon.reloading } };
});

// ---- collision: run at a wall for 2s and confirm we are stopped ----
const collide = await page.evaluate(async () => {
  window.__fps.teleport(0, 30, Math.PI); // facing -Z, wall is far; aim at south wall instead
  window.__fps.teleport(0, 28, 0); // yaw 0 looks -Z... north will be negative
  const g = window.__fps.game;
  g.player.yaw = Math.PI; // face +Z toward the south wall at z=34
  window.__fps.setMove(1, 0);
  for (let i = 0; i < 180; i++) g.player.update(1 / 60, g.input, g.arena.colliders);
  window.__fps.setMove(0, 0);
  return { z: +g.player.position.z.toFixed(2), x: +g.player.position.x.toFixed(2) };
});

// ---- enemy shoots back: does the player take damage? ----
const incoming = await page.evaluate(async () => {
  const g = window.__fps.game;
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  g.player.health = 100;
  g.player.alive = true;
  window.__fps.teleport(0, 18, Math.PI);
  const mod = await import('/game/src/enemy.js');
  const e = new mod.Enemy(g.rng, { x: 0, z: 10 }, 1);
  g.scene.add(e.mesh);
  g.enemies.push(e);
  e.state = 'engage';
  e.lastSeen.set(0, 0, 18);
  let dmgEvents = 0;
  for (let i = 0; i < 300; i++) {
    e.update(1 / 30, g.player, g.arena, { onShoot: () => { dmgEvents++; }, onKill: () => {} });
  }
  return { health: +g.player.health.toFixed(1), dmgEvents, enemyState: e.state, enemyMovedTo: { x: +e.position.x.toFixed(2), z: +e.position.z.toFixed(2) } };
});

console.log('STARTED', JSON.stringify(started));
console.log('AFTER_SPAWN', JSON.stringify(afterSpawn));
console.log('SPREAD', JSON.stringify({ stand: spreadStand, running: spreadRun, crouch: spreadCrouch }));
console.log('HITTEST', JSON.stringify(hitTest));
console.log('AMMO', JSON.stringify(ammo));
console.log('COLLIDE', JSON.stringify(collide));
console.log('INCOMING', JSON.stringify(incoming));
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
