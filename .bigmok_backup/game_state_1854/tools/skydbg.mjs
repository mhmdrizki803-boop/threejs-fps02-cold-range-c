import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:600,height:300} });
p.on('console',m=>console.log('PAGE:',m.type(),m.text().slice(0,300)));
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
const out = await p.evaluate(()=>{
  const g=window.__fps.game;
  const sky = g.arena.group.children.find(o=>o.isMesh && o.geometry.type==='SphereGeometry');
  const u = sky.material.uniforms;
  // force hot pink to prove the material is drawing at all
  // Replace the fragment shader with a flat constant to isolate the pipeline.
  sky.material.fragmentShader = 'void main(){ gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }';
  sky.material.vertexShader = 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }';
  sky.material.needsUpdate = true;
  sky.material.fog = false; sky.material.needsUpdate = true;
  const savedFog = g.scene.fog; g.scene.fog = null;
  g.renderer.render(g.scene, g.camera);
  g.scene.fog = savedFog;
  return { uniforms: Object.keys(u), top: u.topColor.value.getHexString(),
    toneMapping: g.renderer.toneMapping, exposure: g.renderer.toneMappingExposure,
    outputCS: g.renderer.outputColorSpace, camFar: g.camera.far, skyScale: sky.scale.toArray() };
});
console.log(JSON.stringify(out));
await p.waitForTimeout(300);
await p.screenshot({path:'shot-pink.png'});
await b.close();
