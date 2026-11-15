import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[]; p.on('pageerror',e=>errs.push('ERR '+e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(600);
await p.click('#play'); await p.waitForTimeout(500);

const out = await p.evaluate(async ()=>{
  const f = window.__fps;
  const res = { dmgCfg: f.damage };
  // shootBot returns whatever the harness wants; capture it
  try { res.shootBot0 = f.shootBot(0); } catch(e) { res.shootBotErr = String(e); }
  await new Promise(r=>setTimeout(r,300));
  res.after = f.state();
  return res;
});
console.log(JSON.stringify(out,null,1));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
