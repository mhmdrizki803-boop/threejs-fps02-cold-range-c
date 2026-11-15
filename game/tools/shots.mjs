import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors=[]; page.on('pageerror',e=>errors.push('PAGEERR '+e.message));
page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text())});
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);
await page.click('#play');
await page.waitForTimeout(500);

// Stage a readable firefight: two enemies at known ranges, player aiming at one.
await page.evaluate(async () => {
  const g = window.__fps.game;
  for (const e of [...g.enemies]) e.dispose(g.scene);
  g.enemies.length = 0;
  const mod = await import('/game/src/enemy.js');
  const mk = (x, z, yaw) => { const e = new mod.Enemy(g.rng, { x, z }, 1); e.yaw = yaw; e.state='engage'; e.lastSeen.set(g.player.position.x,0,g.player.position.z); g.scene.add(e.mesh); g.enemies.push(e); return e; };
  mk(-4.5, 4, 0.2);
  mk(5.5, -2, -0.4);
  g.player.position.set(0, 0, 16); g.player.yaw = 0.05; g.player.pitch = -0.02;
  g.player.health = 68; g.weapon.mag = 7; g.weapon.reserve = 48; g.score = 640; g.kills = 7; g.timeLeft = 74;
  g.weapon.bloom = 0.02;
  g.player.syncCamera(0);
  window.__fps.aimAt(-4.5, 4, 1.4);
  g.player.pitch = -0.015;
  g.update(1/60);
  g.weapon.fire(g.player, g.enemies, g.arena.colliders);
  g.update(1/60);
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-fight.png' });

// ADS + crouch shot
await page.evaluate(() => {
  const g = window.__fps.game;
  g.player.health = 42; g.weapon.mag = 2; g.score = 1280; g.kills = 11; g.timeLeft = 18;
  g.input.crouch = true; g.input.ads = true;
  for (let i=0;i<30;i++){ g.weapon.update(1/60,g.player,{ads:true}); }
  g.player.syncCamera(0); g.update(1/60);
});
await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-ads.png' });
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
