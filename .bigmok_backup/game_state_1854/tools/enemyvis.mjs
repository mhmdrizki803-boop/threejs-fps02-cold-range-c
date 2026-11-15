import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:800,height:500} });
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
const out = await p.evaluate(async ()=>{
  const g=window.__fps.game;
  const mod = await import('/game/src/enemy.js');
  const e = new mod.Enemy(g.rng, {x:0,z:6}, 1);
  g.scene.add(e.mesh); g.enemies.push(e);
  g.scene.updateMatrixWorld(true);
  const V3 = g.camera.position.constructor;
  const tmp = new V3();
  // bounds of the visual group
  let minY=1e9,maxY=-1e9,minX=1e9,maxX=-1e9;
  e.mesh.traverse(o=>{ if(o.isMesh){ const p=o.getWorldPosition(tmp); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);} });
  const mats = [];
  e.mesh.traverse(o=>{ if(o.isMesh) mats.push({geo:o.geometry.type, mat:o.material.type, vis:o.visible, matVis:o.material.visible, op:o.material.opacity, tr:o.material.transparent}); });
  return { meshPos:e.mesh.position.toArray().map(v=>+v.toFixed(2)), meshVisible:e.mesh.visible,
    meshScale:e.mesh.scale.toArray(), bounds:{minY:+minY.toFixed(2),maxY:+maxY.toFixed(2),minX:+minX.toFixed(2),maxX:+maxX.toFixed(2)},
    meshCount: mats.length, sample: mats.slice(0,6), sceneHas: !!e.mesh.parent, parentType:e.mesh.parent?.type };
});
console.log(JSON.stringify(out,null,1));
await b.close();
