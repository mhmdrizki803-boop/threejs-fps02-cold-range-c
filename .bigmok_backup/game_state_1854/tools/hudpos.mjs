import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play'); await p.waitForTimeout(300);
const info = await p.evaluate(()=>{
  const ids=['health-panel','ammo-panel','timer-panel','score-panel','wave-panel','health-value','ammo-mag','score-value','timer-value','crosshair','hitmarker'];
  const o={};
  for(const id of ids){ const e=document.getElementById(id); const r=e.getBoundingClientRect();
    const cs=getComputedStyle(e);
    o[id]={rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], op:cs.opacity, vis:cs.visibility, disp:cs.display, color:cs.color}; }
  return o;
});
console.log(JSON.stringify(info,null,1));
await b.close();
