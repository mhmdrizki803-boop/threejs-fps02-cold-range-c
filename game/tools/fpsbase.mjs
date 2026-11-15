import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(() => window.__fps);
await page.evaluate(() => window.__fps.start());
await page.waitForTimeout(1500);
const base = await page.evaluate(async () => {
  const g = window.__fps.game;
  const a = g.frameCount; await new Promise(r => setTimeout(r, 1200)); return g.frameCount - a;
});
const withBots = await page.evaluate(async () => {
  const { createShooters, makeRng } = await import('./src/shooters.js');
  const g = window.__fps.game;
  const sh = createShooters(g.scene, g.arena.colliders, makeRng(1));
  const a = g.frameCount; await new Promise(r => setTimeout(r, 1200));
  const f = g.frameCount - a;
  sh.list.forEach(b => b.mesh.removeFromParent());
  return f;
});
console.log(`swiftshader frames/1.2s — baseline ${base}, +6 bots ${withBots}`);
await browser.close();
