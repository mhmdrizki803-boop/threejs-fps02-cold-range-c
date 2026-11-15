import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(() => window.__fps);
await page.evaluate(() => window.__fps.start());
await page.waitForTimeout(2500); // let the existing game loop actually run
const st = await page.evaluate(async () => {
  const { createShooters, makeRng } = await import('./src/shooters.js');
  const g = window.__fps.game;
  const sh = createShooters(g.scene, g.arena.colliders, makeRng(1));
  const before = g.frameCount;
  await new Promise(r => setTimeout(r, 600));
  return {
    framesBefore: before, framesAfter: g.frameCount,
    state: window.__fps.state(),
    botsDrawn: sh.list.filter(b => b.mesh.parent === g.scene).length,
    enemyClassStillWorks: g.enemies.length >= 0,
  };
});
console.log(JSON.stringify(st, null, 2));
await page.screenshot({ path: 'tools/shot-live.png' });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
