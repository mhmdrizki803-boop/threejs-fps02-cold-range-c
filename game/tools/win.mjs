import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play'); await p.waitForTimeout(900);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/1-range.png'});
// play a bit, aim down sights and fire so the shot has recoil/flash
await p.evaluate(()=>{
  const g=window.__fps;
  // move forward slightly and fire a burst through the public path
  for (let i=0;i<3;i++) g.shootBot(0);
});
await p.waitForTimeout(250);
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/3-yard.png'});
const after = await p.evaluate(()=>window.__fps.state());
console.log('MID', JSON.stringify({hp:after.health,mag:after.mag,kills:after.kills,alive:after.alive}));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
