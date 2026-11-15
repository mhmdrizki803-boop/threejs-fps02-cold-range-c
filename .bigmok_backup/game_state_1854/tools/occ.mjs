import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:600,height:300} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
const out = await p.evaluate(()=>{
  const g=window.__fps.game;
  const THREEm = g.camera.position.constructor;
  const ray = new (g.weapon.raycaster.constructor)();
  ray.set(new THREEm(0,1.6,16), new THREEm(0,1,0)); ray.far = 300;
  const all=[]; g.scene.traverse(o=>{ if(o.isMesh) all.push(o); });
  const hits = ray.intersectObjects(all,false).slice(0,5).map(h=>({
    dist:+h.distance.toFixed(2), geo:h.object.geometry.type, mat:h.object.material.type,
    color:h.object.material.color ? h.object.material.color.getHexString() : null,
    renderOrder:h.object.renderOrder, side:h.object.material.side
  }));
  const down = new (g.weapon.raycaster.constructor)();
  down.set(new THREEm(0,1.6,16), new THREEm(0,-1,0)); down.far=50;
  const dHits = down.intersectObjects(all,false).slice(0,3).map(h=>({dist:+h.distance.toFixed(2),geo:h.object.geometry.type}));
  return { up: hits, down: dHits, meshCount: all.length };
});
console.log(JSON.stringify(out,null,1));
await b.close();
