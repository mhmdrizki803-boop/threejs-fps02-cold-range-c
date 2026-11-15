import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8777/game/index.html';
const errors = [];

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (m) => {
  if (m.type() === 'error') errors.push('CONSOLE: ' + m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__fps, null, { timeout: 20000 });
await page.waitForTimeout(1200);

const boot = await page.evaluate(() => ({
  hud: window.__fps.hud(),
  state: window.__fps.state(),
  canvas: (() => {
    const c = document.getElementById('view');
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, cw: c.width, ch: c.height };
  })(),
  webgl: !!document.getElementById('view').getContext('webgl2'),
}));
console.log('BOOT', JSON.stringify(boot, null, 1));
console.log('ERRORS', JSON.stringify(errors, null, 1));
await page.screenshot({ path: '/home/ubuntu/fpsC/game/tools/shot-menu.png' });
await browser.close();
