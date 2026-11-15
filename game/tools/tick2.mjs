import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:640,height:360} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play');
const t0=Date.now(); const s=[];
for (let i=0;i<5;i++){
  await p.waitForTimeout(1000);
  const st=await p.evaluate(()=>window.__fps.state());
  s.push({wall:((Date.now()-t0)/1000).toFixed(1), sim:+st.elapsed.toFixed(2), left:+st.timeLeft.toFixed(1), hp:st.health});
}
console.log('SAMPLES', JSON.stringify(s));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
