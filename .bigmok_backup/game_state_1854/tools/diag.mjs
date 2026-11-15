import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror',e=>console.log('PAGEERR',e.message));
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);
const out = await page.evaluate(async () => {
  const g = window.__fps.game;
  g.renderer.render = () => {};
  g.start();
  g.update(1/60);
  // clear and place a target straight ahead
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  window.__fps.teleport(0, 18, Math.PI);
  g.player.pitch = 0; g.player._recoilPitch = 0;
  const mod = await import('/game/src/enemy.js');
  const e = new mod.Enemy(g.rng, { x: 0, z: 10 }, 1);
  g.scene.add(e.mesh); g.enemies.push(e);
  e.mesh.updateMatrixWorld(true);
  g.player.yaw = Math.PI; g.player.pitch = 0;
  g.player.syncCamera(0);
  g.camera.updateMatrixWorld(true);
  // where does camera look, and where are hitboxes?
  const camPos = g.camera.getWorldPosition(new (await import('/game/src/../vendor/three/three.module.min.js')).Vector3());
  const hb = e.hitboxes.map(h => { const p = h.getWorldPosition(h.position.clone()); return { part: h.userData.part, y: +p.y.toFixed(2), z: +p.z.toFixed(2) }; });
  const dirs = {};
  // fire 20 shots, log spread + hits
  let hits = 0, parts = {};
  g.weapon.mag = 200;
  for (let i = 0; i < 20; i++) {
    g.weapon.cooldown = 0; g.weapon.bloom = 0;
    window.__fps.aimAt(0, 10, 1.62);
    const r = window.__fps.fire();
    if (r.hit) { hits++; parts[r.part] = (parts[r.part]||0)+1; }
  }
  return { camPos: {x:+camPos.x.toFixed(2), y:+camPos.y.toFixed(2), z:+camPos.z.toFixed(2)}, yaw:+g.player.yaw.toFixed(3), hb, hits, parts,
           aimDir: (()=>{const d=g.player.aimDirection(); return {x:+d.x.toFixed(3),y:+d.y.toFixed(3),z:+d.z.toFixed(3)};})(),
           enemyPos: {x:e.position.x, z:e.position.z}, enemyYaw:+e.yaw.toFixed(3) };
});
console.log(JSON.stringify(out,null,1));
await browser.close();
