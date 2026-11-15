import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1024,height:576} });
const errs=[];
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text().slice(0,300)); });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForTimeout(2500);
const boot = await p.evaluate(()=>({
  hasFps: !!window.__fps,
  keys: Object.keys(window.__fps||{}),
  hud: window.__fps?.hud ? window.__fps.hud() : null,
  state: window.__fps?.state ? window.__fps.state() : null,
  dom: {
    health: document.getElementById('health-value')?.textContent,
    mag: document.getElementById('ammo-mag')?.textContent,
    reserve: document.getElementById('ammo-reserve')?.textContent,
    timer: document.getElementById('timer-value')?.textContent,
    score: document.getElementById('score-value')?.textContent,
    title: document.getElementById('overlay-title')?.textContent,
  }
}));
console.log('BOOT', JSON.stringify(boot,null,1));
console.log('ERRORS', JSON.stringify(errs,null,1));
await p.screenshot({path:'live-menu.png'});
await b.close();
