import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(()=>window.__fps);

// ---- A: AFK player, full 150s. Does the round end in a loss? ----
const afk = await page.evaluate(() => {
  const g = window.__fps.game;
  const r = g.renderer.render.bind(g.renderer); g.renderer.render = () => {};
  g.start();
  let t = 0, dieAt = null;
  for (let i = 0; i < 60 * 160 && g.state === 'playing'; i++) {
    g.update(1 / 60); t += 1 / 60;
    if (!g.player.alive && dieAt === null) dieAt = +t.toFixed(2);
  }
  const out = { ended: g.state, result: g.result, t: +t.toFixed(2), dieAt, hp: +g.player.health.toFixed(1), kills: g.kills, score: g.score };
  g.renderer.render = r;
  return out;
});

// ---- B: aimbot player, does it win and how long? ----
const bot = await page.evaluate(() => {
  const g = window.__fps.game;
  const r = g.renderer.render.bind(g.renderer); g.renderer.render = () => {};
  g.start();
  let t = 0;
  const shotsPerKill = [];
  let lastKills = 0, shotsAtKill = 0;
  for (let i = 0; i < 60 * 200 && g.state === 'playing'; i++) {
    // Snap to the nearest living enemy's head/torso and fire when the cone is closed.
    let best = null, bestD = 1e9;
    for (const e of g.enemies) {
      if (!e.alive || e.health <= 0) continue;
      const d = Math.hypot(e.position.x - g.player.position.x, e.position.z - g.player.position.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    // A competent player stands still before shooting: kill the velocity so the
    // spread cone closes, which is the whole point of the mechanic.
    if (best && bestD < 26) { g.player.velocity.set(0, 0); }
    g.input.forward = false; g.input.back = false; g.input.left = false; g.input.right = false;
    if (best) {
      window.__fps.aimAt(best.position.x, best.position.z, 1.62);
      g.input.fire = true;
      if (g.weapon.mag === 0 || (g.weapon.mag < 4 && bestD > 20)) g.weapon.startReload();
    } else {
      g.input.fire = false;
      if (g.weapon.mag < 12) g.weapon.startReload();
    }
    g.update(1 / 60); t += 1 / 60;
    if (g.kills !== lastKills) { shotsPerKill.push(g.weapon.shotsFired - shotsAtKill); shotsAtKill = g.weapon.shotsFired; lastKills = g.kills; }
  }
  const out = { ended: g.state, result: g.result, t: +t.toFixed(2), kills: g.kills, score: g.score,
    hp: +g.player.health.toFixed(1), shots: g.weapon.shotsFired, hits: g.weapon.shotsHit,
    acc: +(g.weapon.shotsHit / Math.max(1, g.weapon.shotsFired)).toFixed(3), headshots: g.weapon.headshots,
    shotsPerKill };
  g.renderer.render = r;
  return out;
});

console.log('AFK ', JSON.stringify(afk));
console.log('BOT ', JSON.stringify(bot));
console.log('ERRORS', JSON.stringify(errors));
await browser.close();
