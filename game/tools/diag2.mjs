import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror',e=>console.log('PAGEERR',e.message));
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);
const out = await page.evaluate(async () => {
  const g = window.__fps.game;
  g.renderer.render = () => {};
  g.start(); g.update(1/60);
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  window.__fps.teleport(0, 18, 0);
  const mod = await import('/game/src/enemy.js');
  const e = new mod.Enemy(g.rng, { x: 0, z: 10 }, 1);
  g.scene.add(e.mesh); g.enemies.push(e);
  e.mesh.updateMatrixWorld(true);
  g.player.syncCamera(0); g.camera.updateMatrixWorld(true);

  // Reproduce weapon.fire internals step by step.
  const w = g.weapon;
  w.mag = 5; w.cooldown = 0; w.bloom = 0;
  const origin = g.camera.getWorldPosition(new g.camera.position.constructor());
  const dir = g.player.aimDirection();
  // collect world boxes near the ray
  const blockers = [];
  for (const c of g.arena.colliders) {
    if (Math.abs(c.minZ - 10) < 6 || (c.minZ < 10 && c.maxZ > 10)) {
      if (c.minX < 1 && c.maxX > -1) blockers.push({...c, dist: Math.abs(c.maxZ - 18)});
    }
  }
  const res = [];
  for (let i = 0; i < 5; i++) { w.cooldown = 0; w.bloom = 0; res.push(window.__fps.fire()); }
  return { origin: {x:origin.x,y:+origin.y.toFixed(2),z:origin.z}, dir:{x:+dir.x.toFixed(2),y:+dir.y.toFixed(3),z:+dir.z.toFixed(2)},
    blockers: blockers.slice(0,6), res, camRot: {x:+g.camera.rotation.x.toFixed(3),y:+g.camera.rotation.y.toFixed(3)},
    hitsArr: w.shotsHit, shots: w.shotsFired };
});
console.log(JSON.stringify(out,null,1));
await browser.close();
