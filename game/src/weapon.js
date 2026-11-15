import * as THREE from 'three';
import { WEAPON, COLORS } from './config.js';
import { clamp, damp, lerp } from './util.js';

/**
 * The rifle. Owns ammo, recoil, spread and the hitscan.
 *
 * Spread model (radians, half-angle):
 *   base + move*clamp(speed) * (crouch? 0.52 : 1) * (ads? 0.34 : 1) + bloom
 * Bloom is added per shot and decays, so holding the trigger walks the cone open.
 * Recoil kicks the camera up and drifts sideways; recoilRecover pulls it back.
 * Both numbers are printed by debugStats() so the tuning is testable, not vibes.
 */
export class Weapon {
  constructor(camera, rng) {
    this.camera = camera;
    this.rng = rng;
    this.name = WEAPON.name;

    this.mag = WEAPON.magSize;
    this.reserve = WEAPON.startReserve;
    this.reloading = false;
    this.reloadTimer = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.headshots = 0;
    this.kills = 0;

    this.adsAmount = 0;
    this.kick = 0; // viewmodel kick
    this.kickRot = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.lastFireTime = -99;
    this.flashTimer = 0;
    this.triggerDown = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = WEAPON.range;
    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();

    this.group = this.buildViewModel();
    this.camera.add(this.group);

    this.tracers = [];
    this.shells = [];
    this.impacts = [];
    this.tracerGeo = new THREE.BufferGeometry();
    this.impactMax = 28;
  }

  buildViewModel() {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x22282c, roughness: 0.48, metalness: 0.72 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x161a1c, roughness: 0.86, metalness: 0.08 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2b3a42, roughness: 0.5, metalness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: COLORS.accent });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a2a33, roughness: 0.12, metalness: 0.9, emissive: 0x0b3d4a, emissiveIntensity: 0.8 });

    // receiver
    const rec = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.44), metal);
    g.add(rec);
    // upper rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.022, 0.4), polymer);
    rail.position.set(0, 0.062, -0.02);
    g.add(rail);
    // handguard
    const hg = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.36), polymer);
    hg.position.set(0, -0.004, -0.36);
    g.add(hg);
    // barrel + muzzle brake
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.34, 10), metal);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.012, -0.56);
    g.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.026, 0.09, 8), accent);
    brake.rotation.x = Math.PI / 2;
    brake.position.set(0, 0.012, -0.74);
    g.add(brake);
    // magazine (angled)
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 0.1), polymer);
    mag.position.set(0, -0.14, 0.02);
    mag.rotation.x = 0.16;
    g.add(mag);
    // grip
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.07), polymer);
    grip.position.set(0, -0.1, 0.16);
    grip.rotation.x = -0.32;
    g.add(grip);
    // stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 0.22), polymer);
    stock.position.set(0, -0.01, 0.28);
    g.add(stock);
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.16), accent);
    cheek.position.set(0, 0.04, 0.24);
    g.add(cheek);
    // optic
    const opticBody = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 12), metal);
    opticBody.rotation.x = Math.PI / 2;
    opticBody.position.set(0, 0.1, -0.05);
    g.add(opticBody);
    const lensFront = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16), glass);
    lensFront.position.set(0, 0.1, -0.121);
    lensFront.rotation.y = Math.PI;
    g.add(lensFront);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xff4433 });
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0035, 8), dotMat);
    dot.position.set(0, 0.1, -0.118);
    dot.rotation.y = Math.PI;
    g.add(dot);
    // charging handle detail
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.06), accent);
    ch.position.set(0.055, 0.03, 0.06);
    g.add(ch);
    // side glow strip: reads as "armed" in the dark
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.012, 0.2), glow);
    strip.position.set(0.044, -0.02, -0.1);
    g.add(strip);

    // muzzle flash
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const flash = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), flashMat);
    flash.add(core);
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.1, 5), flashMat);
      spike.rotation.z = Math.PI / 2;
      spike.rotation.x = (i / 4) * Math.PI * 2;
      spike.position.set(0, 0, -0.04);
      spike.translateY(0.02);
      flash.add(spike);
    }
    flash.position.set(0, 0.012, -0.8);
    g.add(flash);
    this.flashGroup = flash;
    this.flashMat = flashMat;

    const muzzleLight = new THREE.PointLight(0xffc074, 0, 9, 2);
    muzzleLight.position.set(0, 0.012, -0.8);
    g.add(muzzleLight);
    this.muzzleLight = muzzleLight;

    g.position.set(0.24, -0.22, -0.42);
    g.rotation.set(0.02, 0.06, 0.0);
    g.scale.setScalar(1.0);
    g.renderOrder = 10;
    this._hipPos = new THREE.Vector3(0.24, -0.22, -0.42);
    this._adsPos = new THREE.Vector3(0.0, -0.128, -0.3);
    return g;
  }

  get ammoText() {
    return `${this.mag} / ${this.reserve}`;
  }

  get isEmpty() {
    return this.mag <= 0;
  }

  canFire() {
    return !this.reloading && this.mag > 0 && this.cooldown <= 0;
  }

  /** Current cone half-angle in radians for this exact frame. */
  currentSpread(player) {
    const speedFactor = clamp(player.speed / 5.2, 0, 1.35);
    const stance = player.crouchAmount >= 0.5 ? WEAPON.spreadCrouchMul : 1;
    const adsMul = this.adsAmount > 0.5 ? WEAPON.spreadAdsMul : 1;
    return WEAPON.spreadBase + WEAPON.spreadMove * speedFactor * stance * adsMul + this.bloom;
  }

  startReload() {
    if (this.reloading || this.mag >= WEAPON.magSize || this.reserve <= 0) return false;
    this.reloading = true;
    this.reloadTimer = WEAPON.reloadTime;
    return true;
  }

  reloadStep(dt) {
    if (!this.reloading) return false;
    this.reloadTimer -= dt;
    if (this.reloadTimer <= 0) {
      const need = WEAPON.magSize - this.mag;
      const take = Math.min(need, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.reloading = false;
      return true; // finished
    }
    return false;
  }

  /**
   * Hitscan one round.
   * @returns {{hit:boolean, part?:string, point?:THREE.Vector3, killed?:boolean, target?:Enemy}}
   */
  fire(player, enemies, colliders) {
    if (!this.canFire()) return { hit: false, dry: this.mag <= 0 };

    this.mag--;
    this.shotsFired++;
    this.cooldown = 60 / WEAPON.rpm;
    this.lastFireTime = 0;
    this.triggerDown = true;

    // ---- aim direction with spread cone ----
    const spread = this.currentSpread(player);
    player.aimDirection(this._dir);
    // Build a basis around the aim direction, then offset inside the cone.
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._dir, this._up).normalize();
    if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
    this._up.crossVectors(this._right, this._dir).normalize();

    const radius = Math.tan(spread) * 1.0;
    const ang = this.rng.next() * Math.PI * 2;
    const mag = radius * Math.sqrt(this.rng.next());
    const ox = Math.cos(ang) * mag;
    const oy = Math.sin(ang) * mag;

    const dir = this._dir.clone()
      .addScaledVector(this._right, ox)
      .addScaledVector(this._up, oy)
      .normalize();

    // ---- origin: camera, nudged to the muzzle so close cover behaves ----
    this.camera.getWorldPosition(this._origin);
    this.group.localToWorld(this._muzzleWorld.set(0, 0.012, -0.8));
    const origin = this._origin.clone();
    // Blend 35% toward the muzzle to avoid shooting through the gun model.
    origin.lerp(this._muzzleWorld, 0.0);
    origin.y -= 0.04;

    this.raycaster.set(origin, dir);
    this.raycaster.far = WEAPON.range;

    // ---- gather targets ----
    const meshes = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      e.mesh.updateMatrixWorld(true);
      for (const h of e.hitboxes) meshes.push(h);
    }

    // ---- world blocks ----
    const worldHits = [];
    for (const c of colliders) {
      const box = new THREE.Box3(
        new THREE.Vector3(c.minX, c.minY, c.minZ),
        new THREE.Vector3(c.maxX, c.maxY, c.maxZ)
      );
      const hitPoint = new THREE.Vector3();
      if (this.raycaster.ray.intersectBox(box, hitPoint)) {
        const d = hitPoint.distanceTo(origin);
        if (d <= WEAPON.range) worldHits.push({ point: hitPoint.clone(), dist: d });
      }
    }
    worldHits.sort((a, b) => a.dist - b.dist);
    const worldDist = worldHits.length ? worldHits[0].dist : Infinity;

    const hits = this.raycaster.intersectObjects(meshes, false);
    const first = hits.length ? hits[0] : null;
    const firstDist = first ? first.distance : Infinity;

    this.addRecoilKick(player, spread);
    this.spawnMuzzleEffects(origin, dir);

    if (first && firstDist < worldDist) {
      const enemy = first.object.userData.enemy;
      const part = first.object.userData.part;
      const mul = first.object.userData.mul ?? 1;
      const dist = firstDist;

      // Distance falloff beyond falloffStart.
      let falloff = 1;
      if (dist > WEAPON.falloffStart) {
        const t = clamp((dist - WEAPON.falloffStart) / (WEAPON.falloffEnd - WEAPON.falloffStart), 0, 1);
        falloff = lerp(1, WEAPON.falloffMin, t);
      }
      const dmg = WEAPON.damage * mul * falloff;
      const res = enemy.takeDamage(dmg, part);

      this.shotsHit++;
      if (part === 'head') this.headshots++;
      if (res.killed) this.kills++;

      this.addTracer(this._muzzleWorld.clone(), first.point.clone(), true);
      this.spawnImpact(first.point, first.face ? first.face.normal : dir.clone().negate(), true);
      return { hit: true, part, point: first.point.clone(), killed: res.killed, target: enemy, damage: dmg };
    }

    // Wall hit or clean miss.
    if (worldHits.length) {
      const p = worldHits[0];
      this.addTracer(this._muzzleWorld.clone(), p.point.clone(), false);
      this.spawnImpact(p.point, dir.clone().negate(), false);
    } else {
      const end = origin.clone().addScaledVector(dir, WEAPON.range);
      this.addTracer(this._muzzleWorld.clone(), end, false);
    }
    return { hit: false, point: worldHits.length ? worldHits[0].point.clone() : null };
  }

  addRecoilKick(player, spread) {
    // Recoil grows with the cone: spraying makes the next shot worse.
    const scale = 0.7 + spread * 6.0;
    const pitch = WEAPON.recoilPitch * scale;
    const yaw = WEAPON.recoilYaw * this.rng.range(-1.6, 1.6) * scale;
    this.recoilPitch = Math.min(WEAPON.recoilMax, this.recoilPitch + pitch);
    this.recoilYaw = clamp(this.recoilYaw + yaw, -WEAPON.recoilMax, WEAPON.recoilMax);
    player.addRecoil(pitch * 0.85, yaw * 0.5);

    this.bloom = Math.min(WEAPON.bloomMax, this.bloom + WEAPON.bloomPerShot);
    this.kick = 1;
    this.kickRot = 1;
    this.flashTimer = 2;
  }

  spawnMuzzleEffects(origin, dir) {
    void dir;
    this.flashMat.opacity = 1;
    this.muzzleLight.intensity = 18;
    this.flashGroup.rotation.z = this.rng.next() * Math.PI * 2;

    // Ejected brass: small box with a little spin, removed after it falls.
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xb98a2e, roughness: 0.35, metalness: 0.85 });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.045), shellMat);
    this.group.localToWorld(shell.position.set(0.05, -0.01, 0.05));
    shell.rotation.set(this.rng.next(), this.rng.next(), this.rng.next());
    shell.userData.vel = new THREE.Vector3(
      this.rng.range(0.9, 1.7),
      this.rng.range(0.6, 1.2),
      this.rng.range(0.2, 0.7)
    );
    shell.userData.spin = new THREE.Vector3(this.rng.range(-14, 14), this.rng.range(-14, 14), this.rng.range(-14, 14));
    shell.userData.life = 1.4;
    this.camera.parent?.add(shell);
    shell.position.copy(this._muzzleWorld);
    shell.position.y -= 0.03;
    this.shells.push(shell);
    void origin;
  }

  addTracer(from, to, hit) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color: hit ? 0xfff0c0 : 0xffd08a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.userData.life = 0.07;
    line.userData.maxLife = 0.07;
    this.tracerHolder = this.tracerHolder || this.camera.parent;
    this.tracerHolder?.add(line);
    this.tracers.push(line);
  }

  spawnImpact(point, normal, onBody) {
    const mat = new THREE.MeshBasicMaterial({
      color: onBody ? 0xff4d3a : 0xffe1a8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const size = onBody ? 0.06 : 0.09;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    q.position.copy(point);
    if (normal.lengthSq() > 0.001) q.lookAt(point.clone().add(normal));
    q.userData.life = 0.5;
    q.userData.maxLife = 0.5;
    this.impactHolder = this.impactHolder || this.camera.parent;
    this.impactHolder?.add(q);
    this.impacts.push(q);

    // Trim old impacts so a long fight cannot bloat the scene.
    while (this.impacts.length > this.impactMax) {
      const old = this.impacts.shift();
      old.parent?.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  update(dt, player, input) {
    // Timers.
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.bloom = Math.max(0, this.bloom - WEAPON.bloomDecay * dt);
    this.recoilPitch = damp(this.recoilPitch, 0, WEAPON.recoilRecover, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, WEAPON.recoilRecover, dt);
    this.kick = damp(this.kick, 0, 14, dt);
    this.kickRot = damp(this.kickRot, 0, 11, dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt * 16);
    this.flashMat.opacity = this.flashTimer > 0.6 ? 1 : Math.max(0, (this.flashTimer - 0.2) / 0.4);
    this.muzzleLight.intensity = this.flashTimer > 0 ? 18 * this.flashTimer : 0;

    const reloadDone = this.reloadStep(dt);
    if (reloadDone) this.onReloadDone?.();

    // ADS blend.
    this.adsAmount = damp(this.adsAmount, input.ads && !this.reloading ? 1 : 0, 13, dt);
    const ads = this.adsAmount;

    // Viewmodel pose: hip -> optic line, plus bob and sway.
    const speedFactor = clamp(player.speed / WEAPON.spreadBase, 0, 1);
    void speedFactor;
    const sway = Math.sin(player.bobPhase) * 0.006;
    const swayY = Math.cos(player.bobPhase * 2) * 0.004;
    this.swayX = damp(this.swayX, sway * (1 - ads * 0.6), 8, dt);
    this.swayY = damp(this.swayY, swayY * (1 - ads * 0.7), 8, dt);

    const px = lerp(this._hipPos.x, this._adsPos.x, ads) + this.swayX;
    const py = lerp(this._hipPos.y, this._adsPos.y, ads) + this.swayY - this.kick * 0.012;
    const pz = lerp(this._hipPos.z, this._adsPos.z, ads) + this.kick * 0.05;
    this.group.position.set(px, py, pz);
    this.group.rotation.x = lerp(0.02, 0.0, ads) + this.kickRot * 0.06;
    this.group.rotation.y = lerp(0.06, 0.0, ads) + this.swayX * 1.5;
    this.group.rotation.z = lerp(0.0, 0.0, ads) + this.swayX * 2.0;

    // Reload animation: drop the muzzle and roll the rifle.
    if (this.reloading) {
      const t = 1 - this.reloadTimer / WEAPON.reloadTime;
      const dip = Math.sin(clamp(t, 0, 1) * Math.PI);
      this.group.position.y -= dip * 0.11;
      this.group.rotation.x += dip * 0.55;
      this.group.rotation.z += dip * 0.3;
    }

    // Effects lifetimes.
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const l = this.tracers[i];
      l.userData.life -= dt;
      l.material.opacity = Math.max(0, l.userData.life / l.userData.maxLife) * 0.85;
      if (l.userData.life <= 0) {
        l.parent?.remove(l);
        l.geometry.dispose();
        l.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const q = this.impacts[i];
      q.userData.life -= dt;
      q.material.opacity = Math.max(0, q.userData.life / q.userData.maxLife) * 0.95;
      if (q.userData.life <= 0) {
        q.parent?.remove(q);
        q.geometry.dispose();
        q.material.dispose();
        this.impacts.splice(i, 1);
      }
    }

    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.userData.life -= dt;
      const v = s.userData.vel;
      v.y -= 9.8 * dt;
      s.position.addScaledVector(v, dt);
      s.rotation.x += s.userData.spin.x * dt;
      s.rotation.y += s.userData.spin.y * dt;
      s.rotation.z += s.userData.spin.z * dt;
      if (s.userData.life <= 0 || s.position.y < -3) {
        s.parent?.remove(s);
        s.geometry.dispose();
        s.material.dispose();
        this.shells.splice(i, 1);
      }
    }
  }

  /** Snapshot for the HUD and for the debug readout. */
  debugStats(player) {
    return {
      mag: this.mag,
      reserve: this.reserve,
      spreadDeg: +((this.currentSpread(player) * 180) / Math.PI).toFixed(3),
      moveSpreadDeg: +(((WEAPON.spreadMove * clamp(player.speed / 5.2, 0, 1.35) * 180) / Math.PI).toFixed(3)),
      bloomDeg: +(((this.bloom * 180) / Math.PI).toFixed(3)),
      recoilPitch: +this.recoilPitch.toFixed(4),
      accuracy: this.shotsFired ? +(this.shotsHit / this.shotsFired).toFixed(3) : 0,
      headshots: this.headshots,
    };
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Standalone weapon factory.
 *
 * The class above is wired to the live Game (tracers, shells, ADS FOV...).
 * This factory is the small, self-contained contract used by tests and by
 * alternate rigs:
 *
 *   createWeapon(camera, rng) -> {
 *     mag, reserve, canFire(), fire(moving, crouched),
 *     reload(), update(dt), recoilOffset(), direction()
 *   }
 *
 * Numbers here are intentionally fixed by spec, not read from config:
 *   magazine 24 · reserve 96 · reload 2.1 s
 *   cone half-angle = 0.004 rad standing, +0.02 while moving, -0.004 crouched
 * Recoil is a pitch/yaw impulse that eases back to zero, never a camera snap.
 * ─────────────────────────────────────────────────────────────────────────── */

export const WEAPON_SPEC = {
  magSize: 24,
  reserveStart: 96,
  reloadTime: 2.1,
  fireInterval: 60 / 620, // one round per 96.8 ms at 620 rpm
  spreadBase: 0.004,
  spreadMove: 0.02,
  spreadCrouch: 0.004,
  recoilPitch: 0.011,
  recoilYaw: 0.0022,
  recoilRecover: 9.0,
  recoilMax: 0.07,
};

export function createWeapon(camera, rng) {
  const S = WEAPON_SPEC;
  // Gameplay randomness must come from the seeded generator only. There is no
  // Math.random fallback: a missing Rng is a wiring bug, not a licence to
  // drift off-seed. Callers pass a seeded Rng (see main.js).
  if (typeof rng !== 'function' && !(rng && (rng.next || rng.float))) {
    throw new Error('createWeapon requires a seeded Rng');
  }
  const rand = typeof rng === 'function' ? rng : () => (rng.next ? rng.next() : rng.float());
  const range = (a, b) => (rng && typeof rng.range === 'function' ? rng.range(a, b) : a + (b - a) * rand());

  const state = {
    mag: S.magSize,
    reserve: S.reserveStart,
    reloading: false,
    reloadTimer: 0,
    cooldown: 0,
    shots: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    kick: 0,
    swayX: 0,
    swayY: 0,
    flash: 0,
  };

  const _dir = new THREE.Vector3();
  const _base = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _offset = { pitch: 0, yaw: 0 };

  // ---- view model: boxes only, parented straight to the camera -----------
  const buildViewModel = () => {
    const g = new THREE.Group();
    g.name = 'weapon-viewmodel';
    const metal = new THREE.MeshStandardMaterial({ color: 0x24292d, roughness: 0.46, metalness: 0.74 });
    const polymer = new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.88, metalness: 0.06 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2b3a42, roughness: 0.5, metalness: 0.5 });
    const glow = new THREE.MeshBasicMaterial({ color: 0x4dd7ff });

    const box = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };

    box(0.085, 0.11, 0.42, metal, 0, 0, -0.02);        // receiver
    box(0.06, 0.022, 0.38, polymer, 0, 0.062, -0.04);  // top rail
    box(0.075, 0.088, 0.34, polymer, 0, -0.004, -0.34); // handguard
    box(0.026, 0.026, 0.32, metal, 0, 0.012, -0.56);   // barrel
    box(0.05, 0.05, 0.08, accent, 0, 0.012, -0.72);    // muzzle brake
    const magMesh = box(0.055, 0.19, 0.1, polymer, 0, -0.14, 0.02); // magazine
    magMesh.rotation.x = 0.16;
    const gripMesh = box(0.05, 0.14, 0.07, polymer, 0, -0.1, 0.16); // grip
    gripMesh.rotation.x = -0.32;
    box(0.055, 0.08, 0.2, polymer, 0, -0.012, 0.27);   // stock
    box(0.04, 0.06, 0.12, accent, 0, 0.095, -0.03);    // optic block
    box(0.002, 0.01, 0.18, glow, 0.044, -0.02, -0.1);  // status strip

    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.14),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    flash.position.set(0, 0.012, -0.8);
    g.add(flash);
    state.flashMesh = flash;

    // Hip position: low right, canted inward like a shouldered carbine.
    g.position.set(0.2, -0.19, -0.34);
    g.rotation.set(0.02, 0.06, 0.015);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false; // view model lives inside the near plane
      }
    });
    return g;
  };

  const group = buildViewModel();
  if (camera && typeof camera.add === 'function') camera.add(group);

  /**
   * Half-angle of the live cone, in radians. Moving opens it, crouching closes
   * it; the floor is zero so a crouched-still shot is never negative spread.
   */
  const spreadFor = (moving, crouched) => {
    let s = S.spreadBase;
    if (moving) s += S.spreadMove;
    if (crouched) s -= S.spreadCrouch;
    return Math.max(0, s);
  };

  const canFire = () => state.mag > 0 && !state.reloading && state.cooldown <= 0;

  /** Base aim direction from the camera (or -Z when there is no camera). */
  const direction = (out = _dir) => {
    if (camera) {
      camera.getWorldDirection(out);
      if (out.lengthSq() < 1e-8) out.set(0, 0, -1);
      return out.normalize();
    }
    return out.set(0, 0, -1);
  };

  /**
   * Consume one round and return the shot vector inside the live cone.
   * The caller owns the raycast; this function owns ammo, timing and recoil.
   */
  const fire = (moving = false, crouched = false) => {
    if (!canFire()) return { fired: false, reason: state.reloading ? 'reloading' : 'empty', spread: spreadFor(moving, crouched) };

    state.mag -= 1;
    state.shots += 1;
    state.cooldown = S.fireInterval;

    const spread = spreadFor(moving, crouched);

    // Cone sampling: sqrt(u) gives a uniform disc, not a centre-heavy blob.
    const u = rand();
    const theta = rand() * Math.PI * 2;
    const radius = spread * Math.sqrt(u);

    direction(_base);
    _right.set(1, 0, 0).applyQuaternion(camera ? camera.quaternion : new THREE.Quaternion());
    _up.set(0, 1, 0).applyQuaternion(camera ? camera.quaternion : new THREE.Quaternion());
    _dir.copy(_base)
      .addScaledVector(_right, Math.cos(theta) * radius)
      .addScaledVector(_up, Math.sin(theta) * radius)
      .normalize();

    // Recoil impulse: mostly vertical, a little unpredictable sideways.
    state.recoilPitch = Math.min(S.recoilMax, state.recoilPitch + S.recoilPitch * range(0.85, 1.15));
    state.recoilYaw += S.recoilYaw * range(-1, 1);
    state.kick = 1;
    state.flash = 1;

    if (state.mag === 0 && state.reserve > 0) {
      // Empty click on the next trigger pull: auto-reload is the caller's call.
      state.emptySince = 0;
    }

    return {
      fired: true,
      spread,
      spreadDeg: (spread * 180) / Math.PI,
      direction: _dir.clone(),
      base: _base.clone(),
      mag: state.mag,
      reserve: state.reserve,
      recoil: { pitch: state.recoilPitch, yaw: state.recoilYaw },
    };
  };

  /** Begin a reload. No-op while already reloading, full, or dry on reserve. */
  const reload = () => {
    if (state.reloading) return false;
    if (state.mag >= S.magSize) return false;
    if (state.reserve <= 0) return false;
    state.reloading = true;
    state.reloadTimer = S.reloadTime;
    return true;
  };

  const finishReload = () => {
    const need = S.magSize - state.mag;
    const take = Math.min(need, state.reserve);
    state.mag += take;
    state.reserve -= take;
    state.reloading = false;
    state.reloadTimer = 0;
  };

  const update = (dt) => {
    const step = Math.max(0, dt || 0);
    if (step === 0) return;

    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - step);

    if (state.reloading) {
      state.reloadTimer -= step;
      if (state.reloadTimer <= 0) finishReload();
    }

    // Recoil eases back: exponential decay, frame-rate independent.
    const k = 1 - Math.exp(-S.recoilRecover * step);
    state.recoilPitch += (0 - state.recoilPitch) * k;
    state.recoilYaw += (0 - state.recoilYaw) * k;
    if (Math.abs(state.recoilPitch) < 1e-5) state.recoilPitch = 0;
    if (Math.abs(state.recoilYaw) < 1e-5) state.recoilYaw = 0;

    state.kick += (0 - state.kick) * (1 - Math.exp(-14 * step));
    state.flash = Math.max(0, state.flash - step * 12);

    // View model follows the recoil: kicks back, tilts up, then settles.
    const reloadDip = state.reloading ? Math.sin((1 - state.reloadTimer / S.reloadTime) * Math.PI) : 0;
    group.position.set(
      0.2 + state.recoilYaw * 0.6,
      -0.19 - state.kick * 0.012 - reloadDip * 0.09,
      -0.34 + state.kick * 0.045
    );
    group.rotation.set(
      0.02 + state.recoilPitch * 1.6 - reloadDip * 0.5,
      0.06 + state.recoilYaw * 2.4,
      0.015 + reloadDip * 0.35
    );
    if (state.flashMesh) state.flashMesh.material.opacity = state.flash;

    // Subtle idle sway from the rng, so the gun is never mathematically dead.
    state.swayX += (range(-1, 1) * 0.0004 - state.swayX) * (1 - Math.exp(-2 * step));
    state.swayY += (range(-1, 1) * 0.0004 - state.swayY) * (1 - Math.exp(-2 * step));
    group.position.x += state.swayX;
    group.position.y += state.swayY;
  };

  /** Current recoil offset to add on top of the player's own pitch/yaw. */
  const recoilOffset = () => {
    _offset.pitch = state.recoilPitch;
    _offset.yaw = state.recoilYaw;
    _offset.x = state.recoilPitch;
    _offset.y = state.recoilYaw;
    return _offset;
  };

  const reset = () => {
    state.mag = S.magSize;
    state.reserve = S.reserveStart;
    state.reloading = false;
    state.reloadTimer = 0;
    state.cooldown = 0;
    state.shots = 0;
    state.recoilPitch = 0;
    state.recoilYaw = 0;
    state.kick = 0;
    state.flash = 0;
  };

  const api = {
    // Literal data properties, mutated in place: reading `w.mag` is always the
    // live round count, and a snapshot copy stays a snapshot.
    get mag() { return state.mag; },
    set mag(v) { state.mag = Math.max(0, Math.min(S.magSize, v | 0)); },
    get reserve() { return state.reserve; },
    set reserve(v) { state.reserve = Math.max(0, v | 0); },
    canFire,
    fire,
    reload,
    update,
    recoilOffset,
    direction,
    // Extras used by the HUD / debug readouts.
    spreadFor,
    get reloading() { return state.reloading; },
    get reloadTimer() { return state.reloadTimer; },
    get shots() { return state.shots; },
    group,
    state,
    reset,
  };

  return api;
}
