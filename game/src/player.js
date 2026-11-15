import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, damp, lerp, resolveCircle } from './util.js';

/**
 * First-person body. Velocity is never set directly: input only steers an
 * acceleration, friction bleeds speed when the keys are released, and the
 * horizontal speed that survives feeds the weapon's spread. That is the whole
 * "stop to aim pays" loop in one place.
 */
export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    this.velocity = new THREE.Vector2(0, 0);
    this.yaw = PLAYER.spawnYaw;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;

    this.crouching = false;
    this.crouchAmount = 0; // 0 standing, 1 fully crouched
    this.sprinting = false;
    this.ads = false;
    this.onGround = true;

    this.eyeHeight = PLAYER.eyeStand;
    this.bobPhase = 0;
    this.bobOffset = 0;
    this.stepDistance = 0;
    this.tiltRoll = 0;
    this.landImpact = 0;

    this.timeSinceHurt = 99;
    this.hurtFlash = 0;
    this.hurtDirection = 0;
    this._wish = new THREE.Vector2();
    this._recoilPitch = 0;
    this._recoilYaw = 0;
    this._tmp = new THREE.Vector3();
  }

  reset() {
    this.position.set(PLAYER.spawn.x, 0, PLAYER.spawn.z);
    this.velocity.set(0, 0);
    this.yaw = PLAYER.spawnYaw;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.crouching = false;
    this.crouchAmount = 0;
    this.sprinting = false;
    this.ads = false;
    this.eyeHeight = PLAYER.eyeStand;
    this.timeSinceHurt = 99;
    this.hurtFlash = 0;
    this._recoilPitch = 0;
    this._recoilYaw = 0;
    this.syncCamera(0);
  }

  get speed() {
    return this.velocity.length();
  }

  /** 0 at a standstill, 1 at full sprint speed - the movement half of spread. */
  get speedFactor() {
    return clamp(this.speed / PLAYER.maxSpeed, 0, 1.35);
  }

  /** Normalised crouch progress, used by both the eye height and the spread. */
  get crouchFactor() {
    return this.crouchAmount;
  }

  look(dx, dy, sensitivity) {
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  /** Camera kick from a shot; recovered smoothly in update(). */
  addRecoil(pitchKick, yawKick) {
    this._recoilPitch += pitchKick;
    this._recoilYaw += yawKick;
  }

  hurt(amount) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceHurt = 0;
    this.hurtFlash = Math.min(1, this.hurtFlash + 0.55 + amount / 60);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
  }

  /**
   * @param {number} dt seconds
   * @param {object} input { forward, back, left, right, sprint, crouch, ads }
   * @param {Array} colliders arena AABB list
   */
  update(dt, input, colliders) {
    // ---- crouch / stance ----
    const wantCrouch = input.crouch;
    this.crouching = wantCrouch;
    this.crouchAmount = damp(this.crouchAmount, wantCrouch ? 1 : 0, 12, dt);
    this.ads = input.ads;

    const sprinting = input.sprint && !wantCrouch && !input.ads &&
      (input.forward || input.back || input.left || input.right);
    this.sprinting = sprinting;

    // ---- wish direction in world space ----
    let fx = 0;
    let fz = 0;
    if (input.forward) fz -= 1;
    if (input.back) fz += 1;
    if (input.left) fx -= 1;
    if (input.right) fx += 1;

    const hasInput = fx !== 0 || fz !== 0;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    if (hasInput) {
      const len = Math.hypot(fx, fz);
      fx /= len;
      fz /= len;
      // Camera looks down -Z at yaw 0.
      const worldX = fx * cos - fz * sin;
      const worldZ = fx * sin + fz * cos;
      this._wish.set(worldX, worldZ);
    } else {
      this._wish.set(0, 0);
    }

    let targetSpeed = PLAYER.maxSpeed;
    if (this.crouching) targetSpeed *= PLAYER.crouchMul;
    else if (this.ads) targetSpeed *= PLAYER.adsMul;
    else if (sprinting) targetSpeed *= PLAYER.sprintMul;

    const targetX = this._wish.x * targetSpeed;
    const targetZ = this._wish.y * targetSpeed;

    // Exponential approach: accel governs the ramp in, friction the slide out.
    const lambda = hasInput ? PLAYER.accel / PLAYER.maxSpeed : PLAYER.friction;
    this.velocity.x = damp(this.velocity.x, targetX, lambda, dt);
    this.velocity.y = damp(this.velocity.y, targetZ, lambda, dt);

    // Snap tiny leftovers so the crosshair is truly still when standing.
    if (!hasInput && this.velocity.lengthSq() < 0.0004) this.velocity.set(0, 0);

    // ---- integrate + collide ----
    const next = this._tmp.set(
      this.position.x + this.velocity.x * dt,
      0,
      this.position.z + this.velocity.y * dt
    );

    const bodyTop = 1.85 - this.crouchAmount * 0.8;
    resolveCircle(next, PLAYER.radius, colliders, bodyTop, 0.0);
    this.position.x = next.x;
    this.position.z = next.z;

    // Crouching under a ledge: if the head would clip, stay crouched.
    // Wide safety net only: the AABB colliders are what actually stop you.
    this.position.x = clamp(this.position.x, -40, 40);
    this.position.z = clamp(this.position.z, -40, 40);

    // ---- eye height, bob, sway ----
    const targetEye = this.crouching ? PLAYER.eyeCrouch : PLAYER.eyeStand;
    const prevEye = this.eyeHeight;
    this.eyeHeight = damp(this.eyeHeight, targetEye, PLAYER.eyeLerp, dt);

    const planarSpeed = this.velocity.length();
    this.stepDistance += planarSpeed * dt;
    if (planarSpeed > 0.4) {
      this.bobPhase += dt * (sprinting ? 13.5 : 9.2);
    } else {
      this.bobPhase += dt * 1.2;
    }
    const bobAmp = clamp(planarSpeed / PLAYER.maxSpeed, 0, 1.3) * 0.032;
    this.bobOffset = Math.sin(this.bobPhase) * bobAmp;
    const swayX = Math.cos(this.bobPhase * 0.5) * bobAmp * 0.7;

    // Strafe lean: subtle roll into lateral movement.
    const lateral = this.velocity.x * cos * -1 + this.velocity.y * sin * -1;
    this.tiltRoll = damp(this.tiltRoll, clamp(lateral * 0.006, -0.05, 0.05), 7, dt);

    // ---- recoil recovery ----
    this._recoilPitch = damp(this._recoilPitch, 0, 9.0, dt);
    this._recoilYaw = damp(this._recoilYaw, 0, 9.0, dt);

    // ---- health ----
    this.timeSinceHurt += dt;
    if (this.alive && this.timeSinceHurt > PLAYER.regenDelay && this.health < PLAYER.maxHealth) {
      this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * dt);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4);

    void prevEye;
    this.syncCamera(swayX);
  }

  syncCamera(swayX = 0) {
    this.camera.position.set(
      this.position.x + swayX,
      this.eyeHeight + this.bobOffset,
      this.position.z
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(
      this.pitch + this._recoilPitch,
      this.yaw + this._recoilYaw,
      this.tiltRoll
    );
  }

  /** Forward vector including pitch, used for firing. */
  aimDirection(out = new THREE.Vector3()) {
    const p = this.pitch + this._recoilPitch;
    const y = this.yaw + this._recoilYaw;
    out.set(
      -Math.sin(y) * Math.cos(p),
      Math.sin(p),
      -Math.cos(y) * Math.cos(p)
    );
    return out.normalize();
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Standalone body factory.
 *
 * The class above is driven by the camera rig; this one is a plain object with
 * no renderer coupling, so it can be dropped into a headless test or a second
 * entity. Same feel: acceleration steering, ground friction, gravity, and
 * axis-by-axis AABB resolution so the body slides along walls instead of
 * sticking to them.
 * ─────────────────────────────────────────────────────────────────────────── */

export const BODY = {
  radius: 0.34,
  heightPad: 0.15, // head clearance above the eye
  eyeStand: 1.7,
  eyeCrouch: 1.1,
  eyeLambda: 12.0,
  walk: 6.5,
  sprint: 9.0,
  crouchSpeed: 3.0,
  accelGround: 60.0,
  accelAir: 16.0,
  friction: 9.5,
  gravity: -24.0,
  jumpSpeed: 7.4,
  stepHeight: 0.45,
  maxHealth: 100,
};

/** Move `v` toward `target` by at most `maxDelta`, never overshooting. */
function approach(v, target, maxDelta) {
  const d = target - v;
  if (Math.abs(d) <= maxDelta) return target;
  return v + Math.sign(d) * maxDelta;
}

/**
 * @param {THREE.Box3[]} colliders world-space AABBs (optionally with a `.ramp` descriptor)
 */
export function createPlayer(colliders = []) {
  const list = colliders || [];
  // Ramps are walkable surfaces, not walls: pulled out so the axis passes can
  // treat them differently from real solids.
  const ramps = [];
  for (let i = 0; i < list.length; i++) if (list[i] && list[i].ramp) ramps.push(list[i]);

  const player = {
    position: new THREE.Vector3(0, 0, 0),
    velocity: new THREE.Vector3(0, 0, 0),
    eyeHeight: BODY.eyeStand,
    health: BODY.maxHealth,
    alive: true,
    crouch: 0, // eased 0..1, mirrored into eyeHeight
    crouching: false,
    sprinting: false,
    onGround: true,
    yaw: 0,
  };

  const _body = new THREE.Box3();

  function bodyBox(out) {
    const h = player.eyeHeight + BODY.heightPad;
    out.min.set(player.position.x - BODY.radius, player.position.y, player.position.z - BODY.radius);
    out.max.set(player.position.x + BODY.radius, player.position.y + h, player.position.z + BODY.radius);
    return out;
  }

  /** Height of a ramp surface under the body's XZ, clamped to its ends. */
  function rampHeight(box, x, z) {
    const r = box.ramp;
    const span = r.max - r.min;
    const t = span === 0 ? 0 : (r.axis === 'z' ? z - r.min : x - r.min) / span;
    return r.lowY + (r.highY - r.lowY) * clamp(t, 0, 1);
  }

  /** Circle-vs-footprint overlap on the XZ plane. */
  function overlapsFootprint(c) {
    const nx = clamp(player.position.x, c.min.x, c.max.x);
    const nz = clamp(player.position.z, c.min.z, c.max.z);
    const dx = player.position.x - nx;
    const dz = player.position.z - nz;
    return dx * dx + dz * dz < BODY.radius * BODY.radius;
  }

  /**
   * One axis at a time: apply the delta, resolve every overlap on that axis
   * only, then move on. Sliding falls out for free because the other axis is
   * never touched.
   */
  function moveAxis(axis, delta) {
    if (delta === 0) return;
    const pos = player.position;
    const vel = player.velocity;
    const start = pos[axis];
    pos[axis] += delta;
    bodyBox(_body);

    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !c.intersectsBox(_body)) continue;

      // Ramps: only block where the wedge is too tall to step onto from here.
      if (c.ramp) {
        const top = rampHeight(c, pos.x, pos.z);
        if (top > pos.y + BODY.stepHeight) {
          pos[axis] = start;
          vel[axis] = 0;
          bodyBox(_body);
        }
        continue;
      }

      // Low enough to walk onto: lift the body instead of stopping it.
      if (c.max.y - pos.y <= BODY.stepHeight && vel.y <= 0.01) {
        pos.y = c.max.y;
        player.onGround = true;
        vel.y = 0;
        bodyBox(_body);
        if (!c.intersectsBox(_body)) continue;
      }

      if (delta > 0) pos[axis] = c.min[axis] - BODY.radius - 1e-4;
      else pos[axis] = c.max[axis] + BODY.radius + 1e-4;
      vel[axis] = 0;
      bodyBox(_body);
    }
  }

  /** Vertical pass: gravity, landing, ceilings and ramp surfaces. */
  function moveY(dt) {
    const pos = player.position;
    const vel = player.velocity;
    const feetBefore = pos.y;
    pos.y += vel.y * dt;
    player.onGround = false;

    const bodyH = player.eyeHeight + BODY.heightPad;

    // Highest walkable surface under the footprint.
    let support = 0; // the floor
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c || !overlapsFootprint(c)) continue;
      const top = c.ramp ? rampHeight(c, pos.x, pos.z) : c.max.y;
      if (top <= feetBefore + BODY.stepHeight + 1e-3 && top > support) support = top;
    }

    if (vel.y <= 0) {
      if (pos.y <= support) {
        pos.y = support;
        vel.y = 0;
        player.onGround = true;
      }
    } else {
      // Rising: clip the head against anything overhead.
      bodyBox(_body);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.ramp || !c.intersectsBox(_body)) continue;
        if (c.min.y >= feetBefore + 0.01) {
          pos.y = Math.min(pos.y, c.min.y - bodyH - 1e-3);
          vel.y = 0;
          bodyBox(_body);
        }
      }
    }

    // Hard floor: the arena pad is at y = 0.
    if (pos.y < 0) {
      pos.y = 0;
      if (vel.y < 0) vel.y = 0;
      player.onGround = true;
    }
  }

  /**
   * @param {number} dt seconds
   * @param {object} input { forward, back, left, right, sprint, crouch, jump, yaw }
   */
  function update(dt, input) {
    if (!player.alive || !(dt > 0)) return;
    const inp = input || {};
    const pos = player.position;
    const vel = player.velocity;

    if (typeof inp.yaw === 'number') player.yaw = inp.yaw;

    // ---- stance ----
    player.crouching = !!inp.crouch;
    player.crouch = damp(player.crouch, player.crouching ? 1 : 0, BODY.eyeLambda, dt);
    player.eyeHeight = lerp(BODY.eyeStand, BODY.eyeCrouch, player.crouch);

    const moving = !!(inp.forward || inp.back || inp.left || inp.right);
    player.sprinting = !!inp.sprint && !player.crouching && player.onGround && moving;

    // ---- wish velocity in world space ----
    const fwd = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
    const side = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let wx = 0;
    let wz = 0;
    if (fwd !== 0 || side !== 0) {
      const sy = Math.sin(player.yaw);
      const cy = Math.cos(player.yaw);
      // Camera-forward is -Z at yaw 0.
      wx = -sy * fwd + cy * side;
      wz = -cy * fwd - sy * side;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len;
      wz /= len;
    }

    const speed = player.crouching ? BODY.crouchSpeed : player.sprinting ? BODY.sprint : BODY.walk;
    const wantX = wx * speed;
    const wantZ = wz * speed;

    const accel = (player.onGround ? BODY.accelGround : BODY.accelAir) * dt;
    vel.x = approach(vel.x, wantX, accel);
    vel.z = approach(vel.z, wantZ, accel);

    // Ground friction bleeds residual speed when the keys are released.
    if (player.onGround && wx === 0 && wz === 0) {
      const k = Math.exp(-BODY.friction * dt);
      vel.x *= k;
      vel.z *= k;
      if (Math.abs(vel.x) < 0.01) vel.x = 0;
      if (Math.abs(vel.z) < 0.01) vel.z = 0;
    }

    // ---- jump + gravity ----
    if (inp.jump && player.onGround && player.crouch < 0.5) {
      vel.y = BODY.jumpSpeed;
      player.onGround = false;
    }
    vel.y += BODY.gravity * dt;
    if (vel.y < -55) vel.y = -55;

    // ---- integrate: X, Z, then Y, resolving each axis on its own ----
    moveAxis('x', vel.x * dt);
    moveAxis('z', vel.z * dt);
    moveY(dt);

    // Never leave the arena footprint, whatever the collider list says.
    pos.x = clamp(pos.x, -19.6, 19.6);
    pos.z = clamp(pos.z, -19.6, 19.6);
  }

  /** @returns {number} remaining health */
  function damage(amount) {
    if (!player.alive || !(amount > 0)) return player.health;
    player.health = Math.max(0, player.health - amount);
    if (player.health === 0) {
      player.alive = false;
      player.velocity.set(0, 0, 0);
    }
    return player.health;
  }

  /** @param {{x:number,z:number}|THREE.Vector3} [spawn] */
  function reset(spawn) {
    const s = spawn || { x: 0, z: 0 };
    player.position.set(s.x || 0, 0, s.z || 0);
    player.velocity.set(0, 0, 0);
    player.health = BODY.maxHealth;
    player.alive = true;
    player.crouch = 0;
    player.crouching = false;
    player.sprinting = false;
    player.eyeHeight = BODY.eyeStand;
    player.onGround = true;
    if (typeof spawn === 'object' && typeof s.yaw === 'number') player.yaw = s.yaw;
  }

  // Hostiles and the round wrapper both speak `hurt`; `damage` is the internal
  // name. Expose one alias so every caller lands on the same channel.
  Object.assign(player, { update, damage, reset, hurt: damage });
  return player;
}
