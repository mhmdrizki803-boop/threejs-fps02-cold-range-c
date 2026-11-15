import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(600);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/0-menu.png'});

await p.click('#play');
await p.waitForTimeout(1200);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/1-range.png'});

// engage: aim at bot 0 and fire twice, capture immediately (muzzle flash + hitmarker)
const shot = await p.evaluate(()=>{
  const f=window.__fps;
  const r1=f.shootBot(0);
  return {r1, st:f.state()};
});
await p.waitForTimeout(60);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/2-cover.png'});

// survive a bit then capture a hurt state
await p.waitForTimeout(2500);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/3-yard.png'});
const st = await p.evaluate(()=>window.__fps.state());
console.log('SHOT', JSON.stringify(shot));
console.log('LATER', JSON.stringify({hp:+st.health.toFixed(0), mode:st.mode, alive:st.alive, mag:st.mag, score:st.score}));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
