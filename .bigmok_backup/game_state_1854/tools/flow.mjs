import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors=[]; page.on('pageerror',e=>errors.push('PAGEERR '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text())});
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);

// --- real click on the real button ---
await page.click('#play');
await page.waitForTimeout(300);
const afterPlay = await page.evaluate(()=>window.__fps.hud());

// --- run the sim (no render) until the round ends, then read the overlay ---
const ended = await page.evaluate(()=>{
  const g=window.__fps.game; const r=g.renderer.render.bind(g.renderer); g.renderer.render=()=>{};
  let t=0; while(g.state==='playing' && t<200){ g.update(1/60); t+=1/60; }
  g.renderer.render=r;
  return {state:g.state,result:g.result,score:g.score,hud:window.__fps.hud()};
});

// --- click the button again: does a fresh round start? ---
await page.click('#play');
await page.waitForTimeout(300);
const restarted = await page.evaluate(()=>({...window.__fps.state(), hud:window.__fps.hud()}));

// --- win path: simulate the quota being met ---
const winPath = await page.evaluate(()=>{
  const g=window.__fps.game; const r=g.renderer.render.bind(g.renderer); g.renderer.render=()=>{};
  g.start();
  g.kills = 12;
  g.update(1/60);
  g.renderer.render=r;
  return {state:g.state, result:g.result, title:document.getElementById('overlay-title').textContent, kicker:document.getElementById('overlay-kicker').textContent,
          overlayHidden:document.getElementById('overlay').classList.contains('hidden'), winClass:document.getElementById('overlay').classList.contains('result-win')};
});

// --- timer expiry path ---
const timeOut = await page.evaluate(()=>{
  const g=window.__fps.game; g.start(); g.timeLeft = 0.01; g.update(1/60);
  return {state:g.state, result:g.result, kicker:document.getElementById('overlay-kicker').textContent, hud:window.__fps.hud()};
});

console.log('AFTER_PLAY',JSON.stringify(afterPlay));
console.log('ENDED',JSON.stringify(ended));
console.log('RESTARTED',JSON.stringify(restarted));
console.log('WINPATH',JSON.stringify(winPath));
console.log('TIMEOUT',JSON.stringify(timeOut));
console.log('ERRORS',JSON.stringify(errors));
await browser.close();
