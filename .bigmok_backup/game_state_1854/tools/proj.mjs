import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play'); await p.waitForTimeout(300);
const out = await p.evaluate(async ()=>{
  const g=window.__fps.game;
  for (const e of [...g.enemies]) e.dispose(g.scene); g.enemies.length=0;
  const mod = await import('/game/src/enemy.js');
  g.player.position.set(0,0,16); g.player.yaw=0; g.player.pitch=0; g.player.syncCamera(0);
  const mk=(x,z)=>{const e=new mod.Enemy(g.rng,{x,z},1); e.state='engage'; e.mesh.rotation.y=Math.PI; g.scene.add(e.mesh); g.enemies.push(e); return e;};
  const a=mk(-3.5,6), c=mk(4.5,2);
  g.update(1/60);
  g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
  const proj = g.enemies.map(e=>{
    const v = e.hitHead.getWorldPosition(e.position.clone());
    v.project(g.camera);
    return { world:[+e.position.x.toFixed(1),+e.position.z.toFixed(1)],
             screen:[Math.round((v.x*0.5+0.5)*1600), Math.round((-v.y*0.5+0.5)*900)], z:+v.z.toFixed(3) };
  });
  // also check ground/obstruction height near camera forward
  return { proj, camY:+g.camera.position.y.toFixed(2), fov:g.camera.fov, state:g.state };
});
console.log(JSON.stringify(out));
await p.screenshot({path:'shot-proj.png'});
await b.close();
