import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:640,height:360} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play');
const samples = [];
for (let i=0;i<6;i++){
  await p.waitForTimeout(1500);
  samples.push(await p.evaluate(()=>{const s=window.__fps.state();return {t:+s.timeLeft.toFixed(2), el:+s.elapsed.toFixed(2), fov:s.fov, hp:s.health};}));
}
// FPS estimate
const fps = await p.evaluate(()=>new Promise(res=>{
  let n=0; const t0=performance.now();
  const f=()=>{n++; if(performance.now()-t0<1000) requestAnimationFrame(f); else res(n);};
  requestAnimationFrame(f);
}));
console.log('SAMPLES', JSON.stringify(samples));
console.log('FPS', fps);
await b.close();
