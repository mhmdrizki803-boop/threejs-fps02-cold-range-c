import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[], warns=[];
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{ if(m.type()==='error')errs.push(m.text().slice(0,160)); if(m.type()==='warning'&&/THREE\./.test(m.text()))warns.push(m.text().slice(0,120)); });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps, null, {timeout:45000});
await p.waitForTimeout(1500);
await p.waitForTimeout(600);
console.log('WARNS', JSON.stringify(warns));
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/0-menu.png'});
await p.evaluate(()=>{ const b=document.getElementById('play'); b.click(); });
await p.waitForTimeout(1500);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/1-range.png'});

// use the dev helper to jump near the end and force outcomes
const api = await p.evaluate(()=>Object.keys(window.__fps));
const info = await p.evaluate(()=>({
  state: window.__fps.state(),
  dom: {hp:document.getElementById('health-value').textContent,
        mag:document.getElementById('ammo-mag').textContent,
        timer:document.getElementById('timer-value').textContent,
        score:document.getElementById('score-value').textContent}
}));
console.log('API', JSON.stringify(api));
console.log('INFO', JSON.stringify(info));
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/2-cover.png'});
await p.waitForTimeout(1500);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/3-yard.png'});
console.log('ERRORS', JSON.stringify(errs));
await b.close();
