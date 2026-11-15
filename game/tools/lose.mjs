import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1280,height:720} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play');
// wait until the round ends (bots kill an idle player)
let ended=null;
for (let i=0;i<40;i++){
  await p.waitForTimeout(500);
  ended = await p.evaluate(()=>({mode:window.__fps.state().mode,
    overlayHidden:document.getElementById('overlay').classList.contains('hidden'),
    title:document.getElementById('overlay-title').textContent,
    copy:document.getElementById('overlay-copy').textContent.slice(0,120),
    btn:document.getElementById('play').textContent.trim()}));
  if (ended.mode!=='playing') break;
}
console.log('ENDED', JSON.stringify(ended,null,1));
await p.screenshot({path:'/home/ubuntu/fpsC/screenshots/5-loss.png'});
// restart via the real button
await p.click('#play'); await p.waitForTimeout(700);
const re = await p.evaluate(()=>({mode:window.__fps.state().mode, hp:window.__fps.state().health,
  left:window.__fps.state().timeLeft, overlayHidden:document.getElementById('overlay').classList.contains('hidden')}));
console.log('RESTART', JSON.stringify(re));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
