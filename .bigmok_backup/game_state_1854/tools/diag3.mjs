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
  const log = [];
  for (let i = 0; i < 60 * 12; i++) {
    g.update(1 / 60);
    if (i % 20 === 0) {
      log.push({ i, n: g.enemies.length, alive: g.enemies.filter(e => e.alive).length,
        pos: g.enemies.map(e => [ +e.position.x.toFixed(1), +e.position.z.toFixed(1), e.state, Math.round(e.health) ]),
        player: [+g.player.position.x.toFixed(1), +g.player.position.z.toFixed(1), Math.round(g.player.health)] });
    }
  }
  return log;
});
console.log(JSON.stringify(out, null, 0));
await browser.close();
