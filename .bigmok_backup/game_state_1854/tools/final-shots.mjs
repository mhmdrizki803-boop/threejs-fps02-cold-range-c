import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{width:1600,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/game/index.html');
await p.waitForFunction(()=>window.__fps);
await p.waitForTimeout(400);

// 1) menu
await p.screenshot({ path:'/home/ubuntu/fpsC/screenshots/4-menu.png' });

await p.click('#play'); await p.waitForTimeout(300);

async function stage(cfg) {
  await p.evaluate(async (c)=>{
    const g=window.__fps.game;
    for (const e of [...g.enemies]) e.dispose(g.scene);
    g.enemies.length=0;
    const mod = await import('/game/src/enemy.js');
    g.player.position.set(c.px,0,c.pz); g.player.yaw=c.yaw; g.player.pitch=c.pitch||0;
    g.player.health=c.hp; g.weapon.mag=c.mag; g.weapon.reserve=c.reserve;
    g.score=c.score; g.kills=c.kills; g.timeLeft=c.time; g.wave=c.wave;
    g.weapon.adsAmount=c.ads?1:0; g.player.crouchAmount=c.crouch?1:0;
    g.player.eyeHeight=c.crouch?1.04:1.62;
    if (c.swing) { g.weapon.kick=0.8; g.weapon.kickRot=0.7; g.weapon.flashTimer=1.4; g.weapon.bloom=0.028; }
    for (const t of c.targets) {
      const e=new mod.Enemy(g.rng,{x:t[0],z:t[1]},1);
      e.mesh.rotation.y = t[2]; e.state='engage'; e.lastSeen.set(c.px,0,c.pz);
      g.scene.add(e.mesh); g.enemies.push(e);
    }
    g.player.syncCamera(0);
    g.scene.updateMatrixWorld(true); g.camera.updateMatrixWorld(true);
    for (let i=0;i<8;i++){ g.weapon.update(1/60,g.player,{ads:c.ads}); }
    g.player.syncCamera(0);
    g.hud.update(1/60,{health:c.hp,mag:c.mag,reserve:c.reserve,timeLeft:c.time,
      score:c.score,wave:c.wave,waves:3,remaining:c.remaining,
      spreadDeg:(g.weapon.currentSpread(g.player)*180/Math.PI),ads:g.weapon.adsAmount,
      hurtFlash:c.hurt?0.7:0,weaponName:'VK-7 CARBINE'});
    if (c.hitmark) g.hud.hit(c.crit);
    g.hud.pushFeed(c.feedText||'HIT 26', c.crit?'crit':'hit');
    g.renderer.render(g.scene,g.camera);
  }, cfg);
  await p.waitForTimeout(350);
}

await stage({ px:0,pz:20,yaw:0.06,pitch:-0.01, hp:100,mag:24,reserve:96,score:0,kills:2,time:132,wave:1,
  targets:[[-6,8,0.4],[7,4,-0.3]], remaining:3, feedText:'WAVE 1 // HOSTILES INBOUND' });
await p.screenshot({ path:'/home/ubuntu/fpsC/screenshots/1-range.png' });

await stage({ px:-2,pz:15,yaw:0.35,pitch:0.0, hp:64,mag:6,reserve:48,score:640,kills:6,time:78,wave:2,
  targets:[[-8,6,0.5]], remaining:2, crouch:true, swing:false, feedText:'HEADSHOT 78', crit:false, hitmark:true, hurt:true });
await p.screenshot({ path:'/home/ubuntu/fpsC/screenshots/2-cover.png' });

await stage({ px:0,pz:16,yaw:0,pitch:0.0, hp:38,mag:2,reserve:24,score:1280,kills:11,time:14,wave:3,
  targets:[[0,6,0],[3.6,3,0]], remaining:1, ads:true, swing:true, feedText:'TARGET DOWN', crit:true, hitmark:true, hurt:true });
await p.screenshot({ path:'/home/ubuntu/fpsC/screenshots/3-yard.png' });

console.log('ERRORS', JSON.stringify(errs));
await b.close();
