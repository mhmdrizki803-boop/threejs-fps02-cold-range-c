import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:800,height:450} });
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(800);
await p.click('#play'); await p.waitForTimeout(300);
const out = await p.evaluate(()=>{
  const g=window.__fps.game;
  g.player.position.set(0,0,22); g.player.yaw=0; g.player.pitch=0; g.player.syncCamera(0);
  g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
  const V3=g.camera.position.constructor;
  const R=g.weapon.raycaster.constructor;
  const res={};
  // cast rays through screen points
  for (const [name,sx,sy] of [['center',0,0],['low-center',0,-0.35],['left',-0.3,0],['far-low',0,-0.6]]){
    const ray=new R(); ray.setFromCamera({x:sx,y:sy}, g.camera); ray.far=300;
    const all=[]; g.scene.traverse(o=>{ if(o.isMesh) all.push(o); });
    const h=ray.intersectObjects(all,false)[0];
    res[name] = h ? {dist:+h.distance.toFixed(1), geo:h.object.geometry.type, mat:h.object.material.type,
                     color:h.object.material.color?h.object.material.color.getHexString():null,
                     name:h.object.name||null, pos:h.object.position.toArray().map(v=>+v.toFixed(1)),
                     map: !!h.object.material.map, emissive:h.object.material.emissive?h.object.material.emissive.getHexString():null} : null;
  }
  return res;
});
console.log(JSON.stringify(out,null,1));
await b.close();
