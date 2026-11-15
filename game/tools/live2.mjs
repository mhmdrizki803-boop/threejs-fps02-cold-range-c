import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[]; p.on('pageerror',e=>errs.push('ERR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CON '+m.text().slice(0,200));});
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(800);

// what API does the live build expose?
const api = await p.evaluate(()=>({keys:Object.keys(window.__fps), dmg:window.__fps.damage, round:window.__fps.roundSeconds}));

// start a round and drive it
await p.click('#play');
await p.waitForTimeout(600);
const started = await p.evaluate(()=>({state:window.__fps.state(), dom:{
  hp:document.getElementById('health-value').textContent,
  mag:document.getElementById('ammo-mag').textContent,
  reserve:document.getElementById('ammo-reserve').textContent,
  timer:document.getElementById('timer-value').textContent,
  score:document.getElementById('score-value').textContent,
  overlay:document.getElementById('overlay').classList.contains('hidden')}}));

// measure headshot vs body via the exposed shootBot helper
const dmg = await p.evaluate(()=>{
  const f=window.__fps; const out={};
  out.damage=f.damage;
  out.hasShootBot = typeof f.shootBot === 'function';
  return out;
});

await p.screenshot({path:'live-play.png'});
console.log('API', JSON.stringify(api));
console.log('STARTED', JSON.stringify(started));
console.log('DMG', JSON.stringify(dmg));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
