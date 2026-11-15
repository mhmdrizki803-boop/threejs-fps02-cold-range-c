import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
await page.goto('http://127.0.0.1:8777/game/index.html');
await page.waitForFunction(() => window.__fps);

const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const { createShooters, makeRng } = await import('./src/shooters.js');
  const { createWeapon } = await import('./src/weapon.js');
  const { createHud } = await import('./src/hud.js');
  const res = {};

  const g = window.__fps.game;
  g.start();
  const sh = createShooters(g.scene, g.arena.colliders, makeRng(0xb1a5c0de));
  res.bots = sh.list.length;
  res.heads = sh.list.filter(b => b.head.userData.head).length;
  res.inScene = sh.list.filter(b => b.mesh.parent === g.scene).length;

  // bot -> player damage goes through player.hurt; wrap it to sample the band
  const dealt = [];
  const realHurt = g.player.hurt.bind(g.player);
  g.player.hurt = (amount, from) => { dealt.push(amount); return realHurt(amount, from); };
  let reported = 0;
  for (let i = 0; i < 180; i++) {
    sh.update(1 / 60, g.player, () => { reported++; }, () => {});
  }
  res.dmgToPlayer = dealt.length;
  res.dmgRange = dealt.length ? [Math.min(...dealt).toFixed(2), Math.max(...dealt).toFixed(2)] : null;

  // player -> bot: the onHit channel, 3 args
  const seen = [];
  sh.update(1 / 60, g.player, (...a) => seen.push(a));
  const tgt = sh.list[0];
  tgt.alive = true; tgt.health = 100;
  const hitRes = sh.applyPlayerHit(new THREE.Vector3(tgt.position.x, 1.62, tgt.position.z + 6), new THREE.Vector3(0, 0, -1), 26, 40);
  res.playerHit = hitRes ? { isHead: hitRes.isHead, dmg: +hitRes.damage.toFixed(2), killed: hitRes.killed } : null;
  res.onHitArgs = seen.length ? seen[0].length : 0;
  res.onHitBotIsTarget = seen.length ? seen[0][0] === tgt : false;
  res.onHitFired = reported + seen.length;
  res.insideArena = sh.list.every(b => Math.abs(b.position.x) <= 15.9 && Math.abs(b.position.z) <= 15.9);

  const cam = g.camera;
  cam.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  cam.getWorldPosition(origin);
  const target = sh.list.find(b => b.alive);
  const dir = new THREE.Vector3().subVectors(target.position, origin).setY(0).normalize();
  const rayHit = sh.raycast(origin, dir, 140);
  res.raycastHitsBot = !!rayHit;
  res.raycastTargetsBot = rayHit ? rayHit.bot === target : false;

  const w = createWeapon(cam, makeRng(3));
  res.mag = w.mag; res.reserve = w.reserve;
  res.inCamera = cam.children.includes(w.group);
  const s1 = w.fire(false, false);
  res.shotAngDeg = +(Math.acos(Math.min(1, s1.direction.dot(s1.base))) * 180 / Math.PI).toFixed(4);
  res.coneDeg = +(s1.spread * 180 / Math.PI).toFixed(4);
  res.magAfter = w.mag;

  const hud = createHud();
  const hp = document.getElementById('health-value');
  hud.setHealth(31);
  res.healthText = hp.textContent;
  res.healthRed = hp.style.color;
  hud.setAmmo(0, 96);
  res.ammoEmptyClass = document.getElementById('ammo').classList.contains('empty');
  hud.setTimer(150);
  res.timerText = document.getElementById('timer-value').textContent;
  hud.hit(false);
  res.hitmarkerOn = document.getElementById('hitmarker').classList.contains('on');
  hud.setMessage('TEST MESSAGE', 'hit');
  res.feedText = document.getElementById('feed').textContent;
  hud.showEnd('SYNC OK', 'contract check', { win: true });
  res.overlayVisible = !document.getElementById('overlay').classList.contains('hidden');
  res.overlayTitle = document.getElementById('overlay-title').textContent;
  hud.hideEnd();
  res.overlayHidden = document.getElementById('overlay').classList.contains('hidden');
  res.missingSafe = (() => { try { hud.setHealth(NaN); hud.setAmmo(undefined, null); hud.setMessage(undefined); return true; } catch { return false; } })();

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  res.frames = g.frameCount;
  return res;
});

console.log(JSON.stringify(out, null, 2));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
