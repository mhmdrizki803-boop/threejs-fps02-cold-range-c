import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, damp, resolveCircle } from './util.js';

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
    this.position.x = clamp(this.position.x, -32.4, 32.4);
    this.position.z = clamp(this.position.z, -32.4, 32.4);

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
