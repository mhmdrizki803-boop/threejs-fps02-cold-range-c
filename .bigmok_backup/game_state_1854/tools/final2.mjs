import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(500);
await p.screenshot({ path:'/home/ubuntu/fpsC/screenshots/4-menu.png' });
await p.click('#play'); await p.waitForTimeout(400);

async function shot(file, cfg) {
  const ok = await p.evaluate(async (c)=>{
    const g=window.__fps.game;
    for (const e of [...g.enemies]) e.dispose(g.scene);
    g.enemies.length=0;
    const mod = await import('/game/src/enemy.js');
    // pose
    g.player.position.set(c.px,0,c.pz);
    g.player.velocity.set(0,0);
    g.player.yaw=c.yaw; g.player.pitch=c.pitch||0;
    g.player.crouchAmount=c.crouch?1:0; g.player.crouching=!!c.crouch;
    g.player.eyeHeight=c.crouch?1.04:1.62;
    g.player.health=c.hp; g.player.alive=true;
    g.weapon.mag=c.mag; g.weapon.reserve=c.reserve; g.weapon.bloom=c.bloom||0;
    g.weapon.adsAmount=c.ads?1:0; g.weapon.kick=c.swing?0.8:0; g.weapon.kickRot=c.swing?0.7:0;
    g.weapon.flashTimer=c.swing?1.3:0;
    g.score=c.score; g.kills=c.kills; g.timeLeft=c.time; g.wave=c.wave;
    for (const t of c.targets) {
      const e=new mod.Enemy(g.rng,{x:t[0],z:t[1]},1);
      e.mesh.rotation.y=t[2]; e.mesh.position.set(t[0],0,t[1]);
      e.state='engage'; e.lastSeen.set(c.px,0,c.pz); e.yaw=t[2];
      g.scene.add(e.mesh); g.enemies.push(e);
    }
    g.player.syncCamera(0);
    g.input.ads=!!c.ads; g.input.crouch=!!c.crouch;
    for (let i=0;i<10;i++) g.weapon.update(1/60,g.player,g.input);
    g.player.syncCamera(0);
    g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
    g.hud.update(1/60,{health:c.hp,mag:c.mag,reserve:c.reserve,timeLeft:c.time,
      score:c.score,wave:c.wave,waves:3,remaining:c.remaining,
      spreadDeg:(g.weapon.currentSpread(g.player)*180/Math.PI),ads:g.weapon.adsAmount,
      hurtFlash:c.hurt?0.65:0,weaponName:'VK-7 CARBINE'});
    g.hud.feedItems=[]; for (const f of (c.feed||[])) g.hud.pushFeed(f[0],f[1]);
    if (c.marker) g.hud.hit(!!c.crit);
    g.renderer.render(g.scene,g.camera);
    const v=e=>0;
    return { yaw:g.player.yaw, cam:g.camera.position.toArray().map(n=>+n.toFixed(1)), st:g.state,
             enemies:g.enemies.length, spread:+((g.weapon.currentSpread(g.player)*180/Math.PI)).toFixed(2) };
  }, cfg);
  await p.waitForTimeout(280);
  await p.screenshot({ path: file });
  return ok;
}

const a1 = await shot('/home/ubuntu/fpsC/screenshots/1-range.png', {
  px:0, pz:22, yaw:-0.30, pitch:-0.015, hp:100, mag:24, reserve:96, score:0, kills:1, time:141, wave:1,
  targets:[[-9,7,0.45],[6.5,3,-0.5]], remaining:3,
  feed:[['WAVE 1 // HOSTILES INBOUND','kill']] });

const a2 = await shot('/home/ubuntu/fpsC/screenshots/2-cover.png', {
  px:-7, pz:13, yaw:0.62, pitch:0.02, hp:58, mag:5, reserve:48, score:700, kills:7, time:64, wave:2,
  targets:[[-13.5,5,0.55]], remaining:1, crouch:true, hurt:true,
  feed:[['HEADSHOT 78','crit'],['TAKING FIRE','crit']], marker:true, crit:true });

const a3 = await shot('/home/ubuntu/fpsC/screenshots/3-yard.png', {
  px:2, pz:17, yaw:0.04, pitch:0.0, hp:34, mag:2, reserve:24, score:1420, kills:11, time:11, wave:3,
  targets:[[0.2,6.5,0],[4.2,3.2,-0.35]], remaining:1, ads:true, swing:true, hurt:true, bloom:0.03,
  feed:[['TARGET DOWN','kill'],['HEADSHOT 78','crit']], marker:true });

console.log(JSON.stringify({a1,a2,a3}));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
