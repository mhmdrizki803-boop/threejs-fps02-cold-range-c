import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(() => window.__fps);
await page.evaluate(async () => {
  const { createShooters, makeRng } = await import('./src/shooters.js');
  const { createWeapon } = await import('./src/weapon.js');
  const g = window.__fps.game;
  g.start();
  const sh = createShooters(g.scene, g.arena.colliders, makeRng(0xb1a5c0de));
  window.__sh = sh;
  // park the bots in a fan in front of the spawn so all six are in frame
  sh.list.forEach((b, i) => {
    b.position.set(-7.5 + i * 3, 0, 4 - (i % 2) * 2.5);
    b.yaw = Math.PI;
    b.mesh.position.set(b.position.x, 0, b.position.z);
    b.mesh.rotation.y = b.yaw;
    b.waypoints = [{ x: b.position.x, z: b.position.z }, { x: b.position.x, z: b.position.z }];
  });
  createWeapon(g.camera, makeRng(4)); // draw the view model too
  window.__fps.teleport(0, 16, 0);
  g.player.pitch = -0.05;
  await new Promise(r => setTimeout(r, 500));
});
await page.waitForTimeout(700);
await page.screenshot({ path: '/home/ubuntu/fpsC/game/tools/shot-bots.png' });
const info = await page.evaluate(() => ({ bots: window.__sh.list.length, visible: window.__sh.list.filter(b => b.mesh.visible).length }));
console.log(JSON.stringify(info));
await browser.close();
