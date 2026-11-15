import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors=[]; page.on('pageerror',e=>errors.push('PAGEERR '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text())});
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);

const out = await page.evaluate(async () => {
  const g = window.__fps.game;
  const r = g.renderer.render.bind(g.renderer); g.renderer.render = () => {};
  g.start();
  const res = {};

  // ---------- 1. acceleration profile (no instant velocity) ----------
  g.player.reset();
  window.__fps.teleport(0, 24, Math.PI);
  g.input.forward = true;
  const accel = [];
  for (let i = 0; i < 40; i++) {
    g.player.update(1/60, g.input, g.arena.colliders);
    if (i % 5 === 0) accel.push(+g.player.speed.toFixed(2));
  }
  g.input.forward = false;
  const fade = [];
  for (let i = 0; i < 30; i++) {
    g.player.update(1/60, g.input, g.arena.colliders);
    if (i % 5 === 0) fade.push(+g.player.speed.toFixed(2));
  }
  res.accelProfile = accel;   // should ramp, not jump to 5.2
  res.decelProfile = fade;     // should glide down, not snap to 0
  res.maxSpeedTarget = 5.2;

  // ---------- 2. crouch: eye height + spread ----------
  g.player.reset();
  window.__fps.teleport(0, 24, Math.PI);
  const standEye = +g.player.eyeHeight.toFixed(2);
  g.input.crouch = true; g.input.forward = true;
  for (let i = 0; i < 90; i++) g.player.update(1/60, g.input, g.arena.colliders);
  const crouchEye = +g.player.eyeHeight.toFixed(2);
  const crouchSpread = +((g.weapon.currentSpread(g.player)*180/Math.PI)).toFixed(3);
  const crouchSpeed = +g.player.speed.toFixed(2);
  g.input.crouch = false;
  for (let i = 0; i < 90; i++) g.player.update(1/60, g.input, g.arena.colliders);
  const standSpread = +((g.weapon.currentSpread(g.player)*180/Math.PI)).toFixed(3);
  const standSpeed = +g.player.speed.toFixed(2);
  g.input.forward = false;
  res.crouch = { standEye, crouchEye, standSpread, crouchSpread, standSpeed, crouchSpeed };

  // ---------- 3. collision against a known wall + a crate ----------
  g.player.reset(); g.player.yaw = 0;
  // south wall is at z = +34 (wall centre), inner face ~33.3
  window.__fps.teleport(12, 30, Math.PI);
  g.input.forward = true;
  for (let i = 0; i < 240; i++) g.player.update(1/60, g.input, g.arena.colliders);
  g.input.forward = false;
  res.wallStop = { z: +g.player.position.z.toFixed(2), minInnerFace: 33.3 };
  // gate gap must also be sealed now
  window.__fps.teleport(0, 30, Math.PI);
  for (let i = 0; i < 240; i++) g.player.update(1/60, g.input, g.arena.colliders);
  g.input.forward = false;
  res.gateStop = { z: +g.player.position.z.toFixed(2) };

  // ---------- 4. enemy perception: patrol -> alert -> engage ----------
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  const mod = await import('/game/src/enemy.js');
  g.player.reset(); window.__fps.teleport(0, 18, Math.PI);
  const e = new mod.Enemy(g.rng, { x: 0, z: 6 }, 1);
  e.yaw = Math.PI; // facing +Z, toward the player
  e.position.set(0, 0, 6);
  g.scene.add(e.mesh); g.enemies.push(e);
  const seen = e.canSee(g.player.position, g.arena.colliders);
  const states = [];
  for (let i = 0; i < 200; i++) {
    e.update(1/60, g.player, g.arena, { onShoot: () => {}, onKill: () => {} });
    if (i % 20 === 0) states.push(e.state + ':' + e.position.z.toFixed(1));
  }
  res.perception = { canSeePlayer: seen, timeline: states, finalState: e.state,
    movedTowardPlayer: +(e.position.z - 6).toFixed(2), playerHurt: +(100 - g.player.health).toFixed(1) };

  // ---------- 5. enemy blocked by cover cannot see ----------
  const blocker = g.arena.colliders.find(c => c.maxY > 2.5 && c.minX < -10 && c.maxX > -30);
  res.coverExists = !!blocker;
  e.position.set(blocker.minX - 2, 0, blocker.minZ - 2);
  e.yaw = Math.atan2(-(g.player.position.x - e.position.x), -(g.player.position.z - e.position.z));
  res.coverBlocksSight = !e.canSee(g.player.position, g.arena.colliders);

  // ---------- 6. recoil climbs and recovers ----------
  g.weapon.mag = 200; g.weapon.bloom = 0; g.weapon.cooldown = 0;
  g.player.reset(); window.__fps.teleport(0, 24, Math.PI);
  const rec = [];
  for (let i = 0; i < 6; i++) { g.weapon.cooldown = 0; g.weapon.fire(g.player, g.enemies, g.arena.colliders); rec.push(+(g.player._recoilPitch*1000).toFixed(1)); }
  for (let i = 0; i < 60; i++) { g.weapon.update(1/60, g.player, { ads: false }); g.player.update(1/60, { forward:false,back:false,left:false,right:false,sprint:false,crouch:false,ads:false }, g.arena.colliders); }
  res.recoil = { climbMillirad: rec, afterRecovery: +(g.player._recoilPitch*1000).toFixed(2) };

  g.renderer.render = r;
  return res;
});
console.log(JSON.stringify(out, null, 1));
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
