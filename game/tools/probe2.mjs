import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);
await page.click('#play');
// force many sim steps quickly
const r = await page.evaluate(() => {
  const g = window.__fps.game;
  const realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = () => {};
  const log=[];
  for (let i=0;i<600;i++){
    g.update(1/60);
    if(i%60===0) log.push({i, spawn:+g.spawnTimer.toFixed(2), spawned:g.spawnedThisWave, alive:g.enemies.filter(e=>e.alive).length, wave:g.wave, hp:+g.player.health.toFixed(0), st:g.state, kills:g.kills});
  }
  g.renderer.render = realRender;
  return {log, spawned:g.spawnedThisWave, enemies:g.enemies.length, st:g.state, kills:g.kills, hp:g.player.health, err:g.lastErr||null};
});
console.log(JSON.stringify(r,null,1));
console.log('ERRORS',JSON.stringify(errors));
await browser.close();
