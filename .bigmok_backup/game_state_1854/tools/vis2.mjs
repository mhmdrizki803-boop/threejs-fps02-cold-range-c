import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:800,height:500} });
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.click('#play'); await p.waitForTimeout(200);
const out = await p.evaluate(async ()=>{
  const g=window.__fps.game;
  for (const e of [...g.enemies]) e.dispose(g.scene); g.enemies.length=0;
  const mod = await import('/game/src/enemy.js');
  g.player.position.set(0,0,16); g.player.yaw=0; g.player.pitch=0;
  g.player.syncCamera(0); g.player.health=100;
  const e = new mod.Enemy(g.rng, {x:0,z:6}, 1);
  e.mesh.rotation.y = Math.PI;
  g.scene.add(e.mesh); g.enemies.push(e);
  // hide everything except the enemy to prove it renders
  const hidden=[];
  g.scene.traverse(o=>{ if(o.isMesh && !e.mesh.getObjectById(o.id) && !isChildOf(e.mesh,o)){ o.visible=false; hidden.push(o);} });
  function isChildOf(root,o){ let n=o; while(n){ if(n===root) return true; n=n.parent; } return false; }
  g.renderer.render(g.scene, g.camera);
  return { hiddenCount: hidden.length, camPos:g.camera.position.toArray().map(v=>+v.toFixed(2)),
           camRot:[g.camera.rotation.x,g.camera.rotation.y].map(v=>+v.toFixed(2)), enemyPos:e.position.toArray() };
});
console.log(JSON.stringify(out));
await p.waitForTimeout(200);
await p.screenshot({path:'shot-isolated.png'});
await b.close();
