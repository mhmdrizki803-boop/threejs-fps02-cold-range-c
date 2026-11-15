import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[], reqs=[];
p.on('pageerror',e=>errs.push('ERR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CON '+m.text().slice(0,200));});
p.on('request',r=>reqs.push(r.url()));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(800);

// --- network audit: nothing off-origin ---
const external = reqs.filter(u=>!u.startsWith('http://127.0.0.1:8777/'));

// --- boot DOM ---
const boot = await p.evaluate(()=>({
  title: document.getElementById('overlay-title').textContent,
  playBtn: document.getElementById('play').textContent.trim(),
  canvas: (()=>{const c=document.getElementById('view');const r=c.getBoundingClientRect();return [r.width,r.height,c.width,c.height];})(),
  importmap: !!document.querySelector('script[type=importmap]'),
  moduleEntry: document.querySelector('script[type=module]')?.getAttribute('src'),
  hudIds: ['crosshair','hitmarker','health-value','ammo-mag','ammo-reserve','timer-value','score-value']
    .map(id=>[id, !!document.getElementById(id)]).filter(x=>!x[1]),
}));

// --- start and check HUD live ---
await p.click('#play');
await p.waitForTimeout(1200);
const live = await p.evaluate(()=>({
  st: window.__fps.state(),
  dom: {hp:document.getElementById('health-value').textContent,
        mag:document.getElementById('ammo-mag').textContent,
        res:document.getElementById('ammo-reserve').textContent,
        timer:document.getElementById('timer-value').textContent,
        score:document.getElementById('score-value').textContent},
  overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
}));

// --- ammo drain + reload cycle through the public API ---
const ammo = await p.evaluate(async ()=>{
  const f=window.__fps; const before=f.state();
  // fire until the mag empties via the exposed helper path
  const log=[];
  for (let i=0;i<30;i++){ const r=f.shootBot(0); log.push(r && r.after!==undefined? r.after : null); }
  await new Promise(r=>setTimeout(r,1200));
  return { before:{mag:before.mag}, after:f.state(), sample: log.slice(-2) };
});

// --- run the clock out to force a loss ---
const loss = await p.evaluate(async ()=>{
  const f=window.__fps;
  // fast-forward: wait for round to end naturally is too slow, so poll state
  const t0=performance.now();
  while (performance.now()-t0 < 3000) await new Promise(r=>requestAnimationFrame(r));
  return f.state();
});

await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/4-play.png'});
console.log('EXTERNAL_REQUESTS', JSON.stringify(external));
console.log('BOOT', JSON.stringify(boot));
console.log('LIVE', JSON.stringify(live));
console.log('AMMO', JSON.stringify(ammo));
console.log('LATER', JSON.stringify(loss));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
