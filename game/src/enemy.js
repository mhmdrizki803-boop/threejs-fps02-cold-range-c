import * as THREE from 'three';
import { ENEMY, COLORS } from './config.js';
import { clamp, angleDelta, resolveCircle, damp, TAU } from './util.js';
import { segmentBlocked } from './arena.js';

const BODY = {
  head: { w: 0.34, h: 0.36, y: 1.62 },
  torso: { w: 0.62, h: 0.72, y: 1.12 },
  pelvis: { w: 0.52, h: 0.34, y: 0.62 },
  legs: { w: 0.52, h: 0.92, y: 0.22 },
};

let UID = 1;

/**
 * A hostile operator. The visible mesh is built from boxes; the same dimensions
 * feed invisible hitboxes, so what you see is what bullets test against.
 */
export class Enemy {
  constructor(rng, spawn, index) {
    this.id = UID++;
    this.rng = rng;
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.velocity = new THREE.Vector2();
    this.yaw = rng.range(0, TAU);
    this.health = ENEMY.health;
    this.alive = true;
    this.index = index;

    this.state = 'patrol';
    this.stateTime = 0;
    this.alertTimer = 0;
    this.lastSeen = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.hasSeen = false;
    this.attackCooldown = rng.range(0.8, 2.2);
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.strafeDir = rng.sign();
    this.strafeTimer = rng.range(0.6, 1.6);
    this.path = null;
    this.pathIndex = 0;
    this.repathTimer = 0;
    this.goal = null;
    this.muzzleFlash = 0;
    this.hitFlash = 0;
    this.deathTimer = 0;
    this.walkPhase = rng.range(0, TAU);
    this.seedOffset = rng.range(0, 10);
    this.crouch = 0;

    this.mesh = this.buildMesh();
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  buildMesh() {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3b4238, roughness: 0.92, metalness: 0.04 });
    const armor = new THREE.MeshStandardMaterial({ color: 0x272c2a, roughness: 0.7, metalness: 0.25 });
    this.clothMat = cloth;
    this.armorMat = armor;
    const skin = new THREE.MeshStandardMaterial({ color: 0x6b5342, roughness: 0.85 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x0d1214, roughness: 0.25, metalness: 0.7, emissive: 0x220a06, emissiveIntensity: 1 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.55, metalness: 0.5 });

    // torso
    const torso = new THREE.Mesh(new THREE.BoxGeometry(BODY.torso.w, BODY.torso.h, 0.32), armor);
    torso.position.y = BODY.torso.y;
    torso.castShadow = true;
    g.add(torso);
    // chest rig
    const rig = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.12), cloth);
    rig.position.set(0, BODY.torso.y + 0.06, 0.17);
    rig.castShadow = true;
    g.add(rig);
    // pelvis
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(BODY.pelvis.w, BODY.pelvis.h, 0.28), cloth);
    pelvis.position.y = BODY.pelvis.y;
    pelvis.castShadow = true;
    g.add(pelvis);
    // legs
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, BODY.legs.h, 0.24), cloth);
      leg.position.set(s * 0.13, BODY.legs.y, 0);
      leg.castShadow = true;
      g.add(leg);
      leg.userData.limb = s;
      if (s === 1) this.legR = leg;
      else this.legL = leg;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.32), armor);
      boot.position.set(s * 0.13, 0.07, 0.04);
      g.add(boot);
    }
    // head
    const head = new THREE.Mesh(new THREE.BoxGeometry(BODY.head.w, BODY.head.h, 0.32), skin);
    head.position.y = BODY.head.y;
    head.castShadow = true;
    g.add(head);
    // helmet
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.36), armor);
    helmet.position.set(0, BODY.head.y + 0.16, -0.01);
    helmet.castShadow = true;
    g.add(helmet);
    const mask = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), visor);
    mask.position.set(0, BODY.head.y + 0.02, 0.16);
    g.add(mask);
    this.visor = mask;

    // arms hold the rifle forward
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.16), cloth);
      arm.position.set(s * 0.36, BODY.torso.y + 0.06, 0.06);
      arm.rotation.x = -0.85;
      arm.castShadow = true;
      g.add(arm);
    }

    // rifle
    const rifle = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.62), gunMat);
    rifle.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 6), gunMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, 0.48);
    rifle.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.1), gunMat);
    mag.position.set(0, -0.14, 0.06);
    rifle.add(mag);
    rifle.position.set(0.2, BODY.torso.y - 0.02, 0.3);
    g.add(rifle);
    this.rifle = rifle;

    // muzzle flash quad
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0 });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), flashMat);
    flash.position.set(0, 0.02, 0.72);
    rifle.add(flash);
    this.flash = flash;
    this.flashMat = flashMat;

    // ------- invisible hitboxes (raycast targets) -------
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hits = new THREE.Group();
    hits.name = 'hitboxes';
    const mk = (part, w, h, d, y, z = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hitMat);
      m.position.set(0, y, z);
      m.userData.enemy = this;
      m.userData.part = part;
      m.userData.mul = part === 'head' ? 3 : part === 'legs' ? 0.75 : 1;
      hits.add(m);
      return m;
    };
    this.hitHead = mk('head', 0.36, 0.4, 0.36, BODY.head.y + 0.02);
    this.hitTorso = mk('torso', 0.66, 0.78, 0.4, BODY.torso.y);
    this.hitPelvis = mk('pelvis', 0.54, 0.36, 0.34, BODY.pelvis.y);
    this.hitLegs = mk('legs', 0.54, 0.9, 0.3, BODY.legs.y);
    g.add(hits);
    this.hitboxes = [this.hitHead, this.hitTorso, this.hitPelvis, this.hitLegs];

    // contact shadow ellipse (cheap, reads well at distance)
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.46, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    g.add(shadow);

    return g;
  }

  /** Eye position used for vision and as the aim origin. */
  eyePoint(out = new THREE.Vector3()) {
    return out.set(this.position.x, 1.58, this.position.z);
  }

  takeDamage(amount, part) {
    if (!this.alive) return { killed: false, part };
    this.health -= amount;
    this.hitFlash = 1;
    // Being shot always pulls attention, even from behind.
    if (this.state === 'patrol') {
      this.state = 'alert';
      this.stateTime = 0;
      this.alertTimer = 0.25;
    }
    const killed = this.health <= 0;
    if (killed) {
      this.alive = false;
      this.state = 'dead';
      this.deathTimer = 0;
      this.velocity.set(0, 0);
      this.flashMat.opacity = 0;
    }
    return { killed, part };
  }

  canSee(targetPos, colliders) {
    const dx = targetPos.x - this.position.x;
    const dz = targetPos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ENEMY.viewRange) return false;

    // Forward is (-sin yaw, -cos yaw) because the model faces -Z at yaw 0.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const dot = (dx * fx + dz * fz) / (dist || 1);
    const inCone = dot > Math.cos(ENEMY.fov / 2);
    // Outside the cone, only an immediate threat registers.
    if (!inCone && dist > 4.5) return false;

    return !segmentBlocked(this.position.x, this.position.z, targetPos.x, targetPos.z, colliders);
  }

  /**
   * @param {number} dt
   * @param {Player} player
   * @param {object} arena
   * @param {object} callbacks { onShoot(enemy), onKill(enemy) }
   */
  update(dt, player, arena, callbacks) {
    this.stateTime += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - dt * 18);
    this.flashMat.opacity = this.muzzleFlash > 0 ? Math.min(1, this.muzzleFlash * 2) : 0;

    if (!this.alive) {
      this.deathTimer += dt;
      // Collapse: pitch forward and sink.
      const t = clamp(this.deathTimer / 0.75, 0, 1);
      this.mesh.rotation.x = -t * Math.PI * 0.48;
      this.mesh.position.y = -t * 0.25;
      this.mesh.position.x = this.position.x;
      this.mesh.position.z = this.position.z;
      for (const h of this.hitboxes) h.visible = false;
      return;
    }

    // Hit flash: push the armour emissive toward red. Only the few materials we
    // created are touched, not the whole hierarchy.
    const f = this.hitFlash;
    this.armorMat.emissive.setRGB(f * 0.55, 0, 0);
    this.clothMat.emissive.setRGB(f * 0.3, 0, 0);

    const playerPos = player.position;
    const distToPlayer = Math.hypot(playerPos.x - this.position.x, playerPos.z - this.position.z);
    const sees = player.alive && this.canSee(playerPos, arena.colliders);

    if (sees) {
      this.lastSeen.copy(playerPos);
      this.hasSeen = true;
      this.lostTimer = 0;
    } else {
      this.lostTimer = (this.lostTimer || 0) + dt;
    }

    switch (this.state) {
      case 'patrol': {
        if (sees) {
          this.state = 'alert';
          this.stateTime = 0;
          this.alertTimer = ENEMY.reaction;
          this.path = null;
        } else {
          this.patrolStep(dt, arena, player);
        }
        break;
      }
      case 'alert': {
        // Turn to face the threat before shooting.
        this.alertTimer -= dt;
        const desired = Math.atan2(-(this.lastSeen.x - this.position.x), -(this.lastSeen.z - this.position.z));
        this.yaw += angleDelta(this.yaw, desired) * Math.min(1, dt * 9);
        if (this.alertTimer <= 0) {
          this.state = 'engage';
          this.stateTime = 0;
        }
        break;
      }
      case 'engage': {
        this.engageStep(dt, player, arena, callbacks, sees, distToPlayer);
        break;
      }
      default:
        break;
    }

    // Face the player during a fight, otherwise face travel direction.
    if (this.state === 'engage' || this.state === 'alert') {
      const desired = Math.atan2(-(this.lastSeen.x - this.position.x), -(this.lastSeen.z - this.position.z));
      if (sees) {
        const aim = Math.atan2(-(playerPos.x - this.position.x), -(playerPos.z - this.position.z));
        this.yaw += angleDelta(this.yaw, aim) * Math.min(1, dt * 8);
      } else {
        this.yaw += angleDelta(this.yaw, desired) * Math.min(1, dt * 4);
      }
    } else if (Math.abs(this.velocity.x) + Math.abs(this.velocity.y) > 0.15) {
      const moveYaw = Math.atan2(-this.velocity.x, -this.velocity.y);
      this.yaw += angleDelta(this.yaw, moveYaw) * Math.min(1, dt * 5);
    }

    // Integrate + collide.
    const next = this.position.clone();
    next.x += this.velocity.x * dt;
    next.z += this.velocity.y * dt;
    resolveCircle(next, ENEMY.radius, arena.colliders, 1.8, 0);
    this.position.x = clamp(next.x, -40, 40);
    this.position.z = clamp(next.z, -40, 40);

    // Animate.
    const planar = Math.hypot(this.velocity.x, this.velocity.y);
    this.walkPhase += dt * (2.2 + planar * 2.6);
    const swing = Math.sin(this.walkPhase) * clamp(planar / 2.6, 0, 1) * 0.55;
    if (this.legL && this.legR) {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
    }
    this.mesh.position.set(this.position.x, this.mesh.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw;
    this.legacyBob = Math.sin(this.walkPhase * 2) * 0.015 * clamp(planar, 0, 1);

    void distToPlayer;
  }

  patrolStep(dt, arena, player) {
    this.repathTimer -= dt;
    if (!this.goal || this.repathTimer <= 0 || !this.path) {
      // Wave defence: if the player is far, advance on their general position
      // (jittered, and only densely enough to look like a sweep). Close in,
      // sweep local cover instead of beelining, which would look robotic.
      const px = player.position.x;
      const pz = player.position.z;
      const far = Math.hypot(px - this.position.x, pz - this.position.z) > 13;
      const target = far
        ? {
            x: clamp(px + this.rng.range(-7, 7), -30, 30),
            z: clamp(pz + this.rng.range(-7, 7), -30, 30),
          }
        : this.rng.pick(arena.patrolPoints);
      this.goal = target;
      const candidate = arena.findPath(this.position, target);
      // A* can fail on a spot that landed inside cover; keep the old route.
      if (candidate && candidate.length) {
        this.path = candidate;
        this.pathIndex = 0;
      } else if (far) {
        this.path = arena.findPath(this.position, { x: px, z: pz });
        this.pathIndex = 0;
      }
      this.repathTimer = this.rng.range(5.0, 8.0);
    }
    this.followPath(dt, ENEMY.speed * 0.9);
    if (!this.path) {
      // No route: drift so the unit never looks frozen.
      this.velocity.x = damp(this.velocity.x, 0, 3, dt);
      this.velocity.y = damp(this.velocity.y, 0, 3, dt);
    }
  }

  followPath(dt, speed) {
    if (!this.path || this.pathIndex >= this.path.length) {
      this.velocity.x = damp(this.velocity.x, 0, 6, dt);
      this.velocity.y = damp(this.velocity.y, 0, 6, dt);
      return;
    }
    const node = this.path[this.pathIndex];
    const dx = node.x - this.position.x;
    const dz = node.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.45) {
      this.pathIndex++;
      return;
    }
    // Aim at the node, but steer the *velocity* toward a capped step so a
    // tiny dt does not become a tiny step. damp() is frame-rate independent,
    // so this converges to `speed` within ~0.4s regardless of refresh rate.
    const tx = (dx / d) * speed;
    const tz = (dz / d) * speed;
    this.velocity.x = damp(this.velocity.x, tx, 9, dt);
    this.velocity.y = damp(this.velocity.y, tz, 9, dt);
  }

  engageStep(dt, player, arena, callbacks, sees, dist) {
    // Hold a fighting distance: close if far, back off if suffocating.
    let moveDir = { x: 0, z: 0 };
    const toPlayerX = player.position.x - this.position.x;
    const toPlayerZ = player.position.z - this.position.z;
    const len = Math.hypot(toPlayerX, toPlayerZ) || 1;

    if (!sees && this.hasSeen) {
      // Hunt the last known position.
      this.repathTimer -= dt;
      if (this.repathTimer <= 0 || !this.path) {
        this.path = arena.findPath(this.position, this.lastSeen);
        this.pathIndex = 0;
        this.repathTimer = 1.2;
      }
      this.followPath(dt, ENEMY.speed * 1.05);
      if ((this.lostTimer || 0) > ENEMY.memory) {
        this.state = 'patrol';
        this.path = null;
        this.hasSeen = false;
      }
      return;
    }

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir = this.rng.sign();
      this.strafeTimer = this.rng.range(0.7, 2.0);
    }

    if (dist > ENEMY.engageMax) {
      moveDir = { x: toPlayerX / len, z: toPlayerZ / len };
    } else if (dist < ENEMY.engageMin) {
      moveDir = { x: -toPlayerX / len, z: -toPlayerZ / len };
    } else {
      // Circle-strafe: perpendicular to the line of sight.
      moveDir = { x: (-toPlayerZ / len) * this.strafeDir, z: (toPlayerX / len) * this.strafeDir };
    }

    // Step sideways only if the spot is walkable, else mirror.
    const speed = ENEMY.speed;
    let tx = moveDir.x * speed;
    let tz = moveDir.z * speed;
    const probeX = this.position.x + tx * 0.35;
    const probeZ = this.position.z + tz * 0.35;
    if (!arena.grid.isFreeWorld(probeX, probeZ)) {
      const alt = arena.findPath(this.position, {
        x: this.position.x - moveDir.x * 3,
        z: this.position.z - moveDir.z * 3,
      });
      if (alt && alt.length > 1) {
        this.path = alt;
        this.pathIndex = 0;
        this.followPath(dt, speed * 0.9);
        this.tryShoot(dt, player, callbacks, sees, dist);
        return;
      }
      this.strafeDir *= -1;
      tx = -tx;
      tz = -tz;
    }

    this.velocity.x = damp(this.velocity.x, tx, 8, dt);
    this.velocity.y = damp(this.velocity.y, tz, 8, dt);
    this.tryShoot(dt, player, callbacks, sees, dist);
  }

  tryShoot(dt, player, callbacks, sees, dist) {
    this.attackCooldown -= dt;

    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstLeft--;
        this.burstTimer = ENEMY.burstDelay;
        this.fire(player, callbacks, sees, dist);
      }
      return;
    }

    if (this.attackCooldown <= 0 && sees && dist < ENEMY.viewRange) {
      this.burstLeft = ENEMY.burst;
      this.burstTimer = 0;
      this.attackCooldown = this.rng.range(ENEMY.burstCooldownMin, ENEMY.burstCooldownMax);
    }
  }

  fire(player, callbacks, sees, dist) {
    this.muzzleFlash = 1;
    if (!sees) return;

    // Accuracy falls with distance and with the shooter's own movement.
    const moving = Math.hypot(this.velocity.x, this.velocity.y) > 0.6 ? 1.55 : 1.0;
    const distFactor = 1 + dist / 22;
    const err = ENEMY.aimError * distFactor * moving * this.rng.range(0.55, 1.5);
    const hitChanceSphere = clamp(0.46 / (1 + dist / 14) - err * 0.5, 0.12, 0.55);

    // Crouching and sprinting both change your silhouette.
    const playerSize = player.crouching ? 0.72 : player.sprinting ? 1.18 : 1.0;
    const hit = this.rng.next() < hitChanceSphere * playerSize;

    callbacks.onShoot(this, hit, err);
    if (hit) {
      const dmg = ENEMY.damage * this.rng.range(0.85, 1.15) * (dist > 20 ? 0.8 : 1);
      player.hurt(dmg, this.position);
    }
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }
}

export function spawnPointFor(rng, arena, player) {
  // Reinforcements arrive outside the player's immediate threat radius but
  // well inside ENEMY.viewRange, so a wave is a fight, not a marathon.
  const MIN_D = 14;
  const MAX_D = 26;
  const within = (p) => {
    const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
    return d > MIN_D && d < MAX_D;
  };
  let options = arena.spawnPoints.filter(within);

  if (!options.length) {
    // Nothing in the ring: walk outward from the far spawns and pick the best.
    options = [...arena.spawnPoints].sort((a, b) => {
      const da = Math.abs(Math.hypot(a.x - player.position.x, a.z - player.position.z) - 20);
      const db = Math.abs(Math.hypot(b.x - player.position.x, b.z - player.position.z) - 20);
      return da - db;
    });
  }

  const base = rng.pick(options);
  let x = base.x + rng.range(-1.2, 1.2);
  let z = base.z + rng.range(-1.2, 1.2);
  // Never spawn inside geometry.
  if (!arena.grid.isFreeWorld(x, z)) {
    x = base.x;
    z = base.z;
  }
  return { x, z };
}
