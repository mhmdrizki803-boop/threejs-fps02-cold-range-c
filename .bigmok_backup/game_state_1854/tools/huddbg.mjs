import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play'); await p.waitForTimeout(400);
const info = await p.evaluate(()=>{
  const hud=document.getElementById('hud');
  const cs=getComputedStyle(hud);
  const hv=document.getElementById('health-value');
  const r=hv.getBoundingClientRect(); const cs2=getComputedStyle(hv);
  return { hudOpacity:cs.opacity, hudDisplay:cs.display, hudZ:cs.zIndex, hudVis:cs.visibility,
    healthText:hv.textContent, healthColor:cs2.color, healthOpacity:cs2.opacity,
    rect:{x:r.x,y:r.y,w:r.width,h:r.height},
    overlayHidden:document.getElementById('overlay').classList.contains('hidden'),
    canvasZ:getComputedStyle(document.getElementById('view')).zIndex,
    bodyBg:getComputedStyle(document.body).backgroundColor };
});
console.log(JSON.stringify(info,null,1));
await b.close();
