import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(() => window.__fps);
const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const { createShooters, makeRng } = await import('./src/shooters.js');
  const { createWeapon } = await import('./src/weapon.js');
  const g = window.__fps.game;
  g.start();
  const sh = createShooters(g.scene, g.arena.colliders, makeRng(0xb1a5c0de));
  sh.list.forEach((b, i) => {
    b.position.set(-7.5 + i * 3, 0, 4 - (i % 2) * 2.5);
    b.mesh.position.set(b.position.x, 0, b.position.z);
    b.waypoints = [{ x: b.position.x, z: b.position.z }, { x: b.position.x, z: b.position.z }];
  });
  const w = createWeapon(g.camera, makeRng(4));
  window.__fps.teleport(0, 16, 0);
  g.player.pitch = -0.05;
  g.player.syncCamera(0);
  g.camera.updateMatrixWorld(true);
  await new Promise(r => setTimeout(r, 400));
  g.camera.updateMatrixWorld(true);

  const ndc = (v) => v.clone().project(g.camera);
  const torso = sh.list.map(b => {
    const p = new THREE.Vector3(b.position.x, 1.08, b.position.z);
    const n = ndc(p);
    return { x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(3), onScreen: Math.abs(n.x) < 1 && Math.abs(n.y) < 1 && n.z > -1 && n.z < 1 };
  });
  const head = sh.list.map(b => { const n = ndc(new THREE.Vector3(b.position.x, 1.62, b.position.z)); return +n.y.toFixed(2); });
  // view model sits in front of the camera; project its stock and muzzle
  // Probe the receiver, not the stock: the stock legitimately sits at the
  // camera's near plane, so its NDC blows up by design.
  const stockWorld = w.group.localToWorld(new THREE.Vector3(0, 0, -0.02));
  const stock = ndc(stockWorld);
  // In-front test: signed depth along the camera's own forward axis. NDC z is
  // useless here (near=0.05/far=400 makes 36 cm read as +0.7).
  const camFwd = new THREE.Vector3();
  g.camera.getWorldDirection(camFwd);
  const depth = stockWorld.clone().sub(g.camera.position).dot(camFwd);
  const muzzle = ndc(w.group.localToWorld(new THREE.Vector3(0, 0.012, -0.8)));
  return {
    torso,
    headsAboveTorso: head.every((h, i) => h > torso[i].y),
    onScreenCount: torso.filter(t => t.onScreen).length,
    viewmodel: { stock: { x: +stock.x.toFixed(2), y: +stock.y.toFixed(2) }, muzzle: { x: +muzzle.x.toFixed(2), y: +muzzle.y.toFixed(2) }, depthMetres: +depth.toFixed(2), inFront: depth > 0 },
    camera: { y: +g.camera.position.y.toFixed(2), fov: g.camera.fov },
    drawCalls: g.renderer.info.render.calls,
    triangles: g.renderer.info.render.triangles,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
