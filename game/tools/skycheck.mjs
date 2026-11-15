import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:800,height:450} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play');
await p.waitForTimeout(300);
// look straight up
await p.evaluate(()=>{
  const g=window.__fps.game;
  for (const e of [...g.enemies]) e.dispose(g.scene); g.enemies.length=0;
  g.player.position.set(0,0,16); g.player.yaw=0; g.player.pitch=1.2; g.player.syncCamera(0);
  g.update(1/60);
});
await p.waitForTimeout(300);
await p.screenshot({path:'shot-up.png'});
const info = await p.evaluate(()=>{
  const g=window.__fps.game;
  const sky = g.arena.group.children.find(o=>o.isMesh && o.geometry.type==='SphereGeometry');
  return { found: !!sky, visible: sky?.visible, renderOrder: sky?.renderOrder, matType: sky?.material.type,
           inFrustum: sky?.frustumCulled, camFar: g.camera.far, camPos: g.camera.position.toArray().map(v=>+v.toFixed(1)) };
});
console.log(JSON.stringify(info));
await b.close();
