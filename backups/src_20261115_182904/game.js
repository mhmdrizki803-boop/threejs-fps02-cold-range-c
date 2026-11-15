import * as THREE from 'three';
import { ROUND, WEAPON, SEED, COLORS } from './config.js';
import { Rng } from './rng.js';
import { buildArena } from './arena.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { Enemy, spawnPointFor } from './enemy.js';
import { Hud } from './hud.js';

/**
 * Round orchestration: waves, score, timers, win/loss, restart.
 * One instance lives for the whole page; start() re-seeds and rebuilds so a
 * restart is a genuinely fresh, identical fight.
 */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(COLORS.fog, 0.0095);

    this.camera = new THREE.PerspectiveCamera(WEAPON.hipFov, 1, 0.05, 400);
    this.scene.add(this.camera);

    this.rng = new Rng(SEED);
    this.hud = new Hud();
    this.player = new Player(this.camera);
    this.weapon = new Weapon(this.camera, this.rng);

    this.enemies = [];
    this.arena = null;
    this.state = 'menu'; // menu | playing | paused | over
    this.result = null;
    this.timeLeft = ROUND.duration;
    this.score = 0;
    this.kills = 0;
    this.wave = 1;
    this.spawnedThisWave = 0;
    this.killedThisWave = 0;
    this.spawnTimer = 0;
    this.interWave = 0;
    this.elapsed = 0;
    this.hitFlashCooldown = 0;
    this.fov = WEAPON.hipFov;
    this.lastTime = 0;
    this.frameCount = 0;
    this.onReloadDone = null;

    this.weapon.onReloadDone = () => this.hud.pushFeed('RELOADED', '');

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.input = {
      forward: false, back: false, left: false, right: false,
      sprint: false, crouch: false, ads: false, fire: false,
    };
    this.sensitivity = 0.0021;
    this.locked = false;
    this.buildWorld();
    this.bindInput();
    this.showMenu();
  }

  // ---------------------------------------------------------------- world
  buildWorld() {
    if (this.arena) {
      this.scene.remove(this.arena.group);
    }
    this.rng.reset(SEED);
    this.arena = buildArena(this.rng);
    this.scene.add(this.arena.group);
    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const keyMap = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
    };

    window.addEventListener('keydown', (e) => {
      const action = keyMap[e.code];
      if (action) {
        this.input[action] = true;
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code === 'KeyR') this.tryReload();
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
      }
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      const action = keyMap[e.code];
      if (action) this.input[action] = false;
    });

    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.input)) this.input[k] = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (e.button === 0) this.input.fire = true;
      if (e.button === 2) this.input.ads = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.fire = false;
      if (e.button === 2) this.input.ads = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.state !== 'playing') return;
      const s = this.sensitivity * (this.input.ads ? 0.6 : 1);
      this.player.look(e.movementX || 0, e.movementY || 0, s);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.state === 'playing') this.pause();
    });

    this.hud.playButton.addEventListener('click', () => {
      if (this.state === 'over') this.start();
      else if (this.state === 'menu') this.start();
      else if (this.state === 'paused') this.resume();
    });

    // Lock the pointer on the first click inside the canvas while playing too.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.locked) this.requestLock();
    });
  }

  requestLock() {
    const p = this.canvas.requestPointerLock?.();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  tryReload() {
    if (this.state !== 'playing') return;
    if (this.weapon.startReload()) this.hud.pushFeed('RELOADING', '');
  }

  // ---------------------------------------------------------------- flow
  showMenu() {
    this.state = 'menu';
    this.hud.setVisible(false);
    this.hud.showOverlay({
      kind: 'start',
      kicker: 'Breach Simulation // Live Fire',
      title: 'BLACKSITE RANGE',
      copy:
        `Three waves of hostile operators are coming through the yard.\n` +
        `Kill ${ROUND.quota} before the clock runs dry. Headshots hit for x3.\n\n` +
        `Move: WASD  ·  Sprint: Shift  ·  Crouch: Ctrl / C  ·  Fire: LMB\n` +
        `Reload: R  ·  Aim: RMB  ·  Pause: Esc`,
      button: 'Enter Range',
    });
  }

  start() {
    this.rng.reset(SEED);
    this.player.reset();
    this.weapon.mag = WEAPON.magSize;
    this.weapon.reserve = WEAPON.startReserve;
    this.weapon.reloading = false;
    this.weapon.reloadTimer = 0;
    this.weapon.bloom = 0;
    this.weapon.recoilPitch = 0;
    this.weapon.recoilYaw = 0;
    this.weapon.shotsFired = 0;
    this.weapon.shotsHit = 0;
    this.weapon.headshots = 0;
    this.weapon.kills = 0;
    this.weapon.adsAmount = 0;

    for (const e of this.enemies) e.dispose(this.scene);
    this.enemies = [];

    this.state = 'playing';
    this.result = null;
    this.timeLeft = ROUND.duration;
    this.score = 0;
    this.kills = 0;
    this.wave = 1;
    this.spawnedThisWave = 0;
    this.killedThisWave = 0;
    this.spawnTimer = 0.8;
    this.interWave = 0;
    this.elapsed = 0;
    this.hud.feedItems = [];
    this.hud.renderFeed();
    this.input.fire = false;
    this.input.ads = false;

    this.fov = WEAPON.hipFov;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    this.hud.hideOverlay();
    this.hud.setVisible(true);
    this.resume();
    this.hud.pushFeed('WAVE 1 // HOSTILES INBOUND', 'kill');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.fire = false;
    document.exitPointerLock?.();
    this.hud.showOverlay({
      kind: 'paused',
      kicker: 'Simulation Halted',
      title: 'PAUSED',
      copy: `Score ${this.score}  ·  ${this.kills} kills  ·  ${Math.ceil(this.timeLeft)}s left\n\nClick to re-enter the range.`,
      button: 'Resume',
    });
  }

  resume() {
    this.state = 'playing';
    this.hud.hideOverlay();
    this.requestLock();
  }

  win() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.result = 'win';
    document.exitPointerLock?.();
    const acc = this.weapon.shotsFired ? (100 * this.weapon.shotsHit) / this.weapon.shotsFired : 0;
    this.hud.showOverlay({
      kind: 'win',
      kicker: 'Range Cleared',
      title: 'MISSION COMPLETE',
      copy:
        `Score ${this.score}\n` +
        `${this.kills} kills  ·  ${this.weapon.headshots} headshots  ·  ${Math.round(acc)}% accuracy\n` +
        `Time remaining ${Math.ceil(this.timeLeft)}s\n\n` +
        `The yard is quiet. Same seed, same fight: run it again and beat this score.`,
      button: 'Run It Again',
    });
  }

  lose(reason) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.result = 'loss';
    document.exitPointerLock?.();
    this.hud.showOverlay({
      kind: 'loss',
      kicker: reason,
      title: 'YOU ARE DOWN',
      copy:
        `Score ${this.score}  ·  ${this.kills}/${ROUND.quota} kills\n` +
        `Survived ${Math.floor(this.elapsed)}s of ${ROUND.duration}s\n\n` +
        `Line up on the head and let the cone close before you squeeze.`,
      button: 'Try Again',
    });
  }

  // ---------------------------------------------------------------- sim
  spawnEnemy() {
    const p = spawnPointFor(this.rng, this.arena, this.player);
    const e = new Enemy(this.rng, p, this.spawnedThisWave);
    this.scene.add(e.mesh);
    this.enemies.push(e);
    this.spawnedThisWave++;
  }

  onEnemyShot(enemy, hit, err) {
    void err;
    // Tracer from the muzzle to the player, so incoming fire is visible.
    if (!this.weapon) return;
    const from = new THREE.Vector3(enemy.position.x, 1.5, enemy.position.z);
    const to = new THREE.Vector3(
      this.player.position.x + this.rng.range(-0.5, 0.5) * (hit ? 0.3 : 1.6),
      1.4 + this.rng.range(-0.6, 0.5),
      this.player.position.z + this.rng.range(-0.5, 0.5) * (hit ? 0.3 : 1.6)
    );
    this.weapon.addTracer(from, to, hit);

    if (hit) {
      // The crosshair hitmarker means *your* round landed. Incoming damage is
      // communicated by the red vignette and the health drop, not by that marker.
      this.hud.pushFeed('TAKING FIRE', 'crit');
      this.player.hurtDirection = Math.atan2(
        enemy.position.z - this.player.position.z,
        enemy.position.x - this.player.position.x
      );
    }
  }

  handleFireResult(res) {
    if (res.dry) {
      this.hud.pushFeed('CLICK — EMPTY', 'crit');
      return;
    }
    if (res.hit) {
      const crit = res.part === 'head';
      this.hud.hit(crit);
      if (res.killed) {
        this.kills++;
        this.killedThisWave++;
        this.score += crit ? 160 : 100;
        this.hud.pushFeed(crit ? 'HEADSHOT KILL' : 'TARGET DOWN', 'kill');
      } else {
        this.hud.pushFeed(crit ? `HEADSHOT ${Math.round(res.damage)}` : `HIT ${Math.round(res.damage)}`, crit ? 'crit' : 'hit');
      }
    }
  }

  update(dt) {
    if (this.state !== 'playing') {
      // Keep the world rendered but frozen behind overlays.
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.elapsed += dt;
    this.timeLeft -= dt;

    // ---- player ----
    this.player.update(dt, this.input, this.arena.colliders);
    if (!this.player.alive) {
      this.lose('KILLED IN ACTION');
      return;
    }

    // ---- weapon ----
    this.weapon.update(dt, this.player, this.input);
    if (this.input.fire && this.weapon.canFire()) {
      // Fire at most once per frame; cooldown gates the rate.
      const res = this.weapon.fire(this.player, this.enemies, this.arena.colliders);
      this.handleFireResult(res);
    } else if (this.input.fire && this.weapon.mag === 0 && !this.weapon.reloading) {
      if (this.weapon.reserve > 0) this.tryReload();
      else if (this.hitFlashCooldown <= 0) {
        this.hitFlashCooldown = 0.35;
        this.hud.pushFeed('OUT OF AMMO', 'crit');
      }
    }
    this.hitFlashCooldown -= dt;

    // FOV: ADs zoom, sprint widen.
    const targetFov = this.input.ads ? WEAPON.adsFov : WEAPON.hipFov + (this.player.sprinting ? 3 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 12);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    // ---- enemies ----
    let aliveCount = 0;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      e.update(dt, this.player, this.arena, {
        onShoot: (en, hit, err) => this.onEnemyShot(en, hit, err),
        onKill: () => {},
      });
      if (e.alive) aliveCount++;
      if (!e.alive && e.deathTimer > 3.2) {
        e.dispose(this.scene);
        this.enemies.splice(i, 1);
      }
    }

    // ---- wave logic ----
    if (this.interWave > 0) {
      this.interWave -= dt;
      if (this.interWave <= 0 && this.wave < ROUND.waves) {
        this.wave++;
        this.spawnedThisWave = 0;
        this.killedThisWave = 0;
        this.spawnTimer = 0.6;
        this.hud.pushFeed(`WAVE ${this.wave} // INBOUND`, 'kill');
      }
      // Fall through: the spawn branch below runs again once the break is over.
      if (this.interWave <= 0 && this.wave >= ROUND.waves && this.killedThisWave >= ROUND.perWave) {
        // cleared
      }
    } else {
      const waveDone = this.spawnedThisWave >= ROUND.perWave && this.killedThisWave >= ROUND.perWave;
      if (waveDone) {
        if (this.wave >= ROUND.waves || this.kills >= ROUND.quota) {
          this.win();
          return;
        }
        this.interWave = ROUND.interWaveDelay;
      } else {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && this.spawnedThisWave < ROUND.perWave && aliveCount < ROUND.maxAlive) {
          this.spawnEnemy();
          this.spawnTimer = ROUND.spawnInterval;
        }
      }
    }

    // ---- win / loss ----
    if (this.kills >= ROUND.quota) {
      this.win();
      return;
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.lose('TIME EXPIRED');
      return;
    }

    // ---- hud ----
    this.hud.update(dt, {
      health: this.player.health,
      mag: this.weapon.mag,
      reserve: this.weapon.reserve,
      timeLeft: this.timeLeft,
      score: this.score,
      wave: this.wave,
      waves: ROUND.waves,
      remaining: Math.max(0, ROUND.perWave - this.killedThisWave),
      spreadDeg: (this.weapon.currentSpread(this.player) * 180) / Math.PI,
      ads: this.weapon.adsAmount,
      hurtFlash: this.player.hurtFlash,
      weaponName: WEAPON.name,
    });

    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
  }
}
