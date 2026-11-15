import * as THREE from 'three';

/**
 * Hostile shooter bots.
 *
 * Contract (headless-testable, no Game coupling):
 *   createShooters(scene, colliders, rng) -> { list, update(dt, player, onHit) }
 *
 *  - 6 bots, each a box torso with a SEPARATE head mesh (own hitbox).
 *  - State machine: patrol (two waypoints) -> engage when line of sight is clear
 *    within 30 units -> stop, face the player, fire every 0.9-1.4 s for 8-14 dmg
 *    on a clear raycast -> back to patrol when sight breaks.
 *  - Bodies stay inside the arena bounds and are pushed out of colliders
 *    axis-by-axis (no sliding diagonally through corners).
 *  - Dead bots respawn after 2.5 s at a seeded spawn point (corpse is hidden,
 *    not removed, so list indices stay stable across a run).
 *  - Bots deal their damage directly through player.hurt(), the same channel
 *    the rest of the sim uses; a blocked ray deals none.
 *  - update(dt, player, onHit) registers the player->bot hit channel:
 *    whenever a player bullet lands (via damage() / applyPlayerHit()),
 *    onHit(bot, point, isHead) fires with exactly those three arguments.
 *
 * Hit detection is a two-pass closest-hit race: every shooter's torso and head
 * AABB is tested with the same ray maths the weapon uses (slab test), and the
 * nearest positive entry wins. Nothing is randomised about what the ray hits —
 * rng is only used for spawn/waypoint selection and the fire interval.
 */

const ARENA = {
  // Interior half-extent of the yard. Walls sit at +-17 (arena.js SIZE = 34),
  // minus the wall thickness, so 15.9 keeps a 0.42-radius body off the concrete.
  half: 15.9,
  minY: 0,
  maxY: 6,
};

export const SHOOTER_TUNING = {
  count: 6,
  radius: 0.42,
  height: 1.8,
  walkSpeed: 1.55,
  turnRate: 7.5, // rad/s toward a waypoint or the player
  viewRange: 30,
  fireMin: 0.9,
  fireMax: 1.4,
  damageMin: 8,
  damageMax: 14,
  respawnTime: 2.5,
  head: { w: 0.34, h: 0.36, y: 1.62, depth: 0.32 }, // 1.44..1.80, sits on the torso
  torso: { w: 0.62, h: 0.72, y: 1.08, depth: 0.32 }, // 0.72..1.44, head starts at 1.44
  pelvis: { w: 0.5, h: 0.34, y: 0.62, depth: 0.28 },
  legs: { w: 0.5, h: 0.9, y: 0.22, depth: 0.24 },
};

const _box = new THREE.Box3();

/** Seeded default generator so `createShooters(scene, colliders)` still works. */
export function makeRng(seed = 0x5eed) {
  let s = seed >>> 0;
  const next = () => {
    // xorshift32: deterministic, cheap, good enough for bot decisions.
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17; s >>>= 0;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return {
    next, // alias used by some call sites
    float: next,
    range(a, b) { return a + (b - a) * next(); },
    int(a, b) { return Math.floor(a + (b - a + 1) * next()); },
    pick(list) { return list[Math.floor(next() * list.length) % list.length]; },
    sign() { return next() < 0.5 ? -1 : 1; },
  };
}

/** Accept any {max:{x,y,z}} shape (THREE.Box3 or a plain record) and fill a Box3. */
function asBox(c, out) {
  if (!c) return null;
  if (typeof c.minX === 'number') {
    out.min.set(c.minX, c.minY ?? 0, c.minZ);
    out.max.set(c.maxX, c.maxY ?? 4, c.maxZ);
    return out;
  }
  if (c.min && c.max) {
    out.min.copy(c.min);
    out.max.copy(c.max);
    return out;
  }
  return null;
}

function boxHeight(c) {
  if (!c) return 0;
  if (typeof c.minX === 'number') return (c.maxY ?? 4) - (c.minY ?? 0);
  if (c.min && c.max) return c.max.y - c.min.y;
  return 0;
}

function insideFootprint(x, z, c) {
  if (!c) return false;
  const minX = c.minX ?? c.min?.x;
  const maxX = c.maxX ?? c.max?.x;
  const minZ = c.minZ ?? c.min?.z;
  const maxZ = c.maxZ ?? c.max?.z;
  return x > minX && x < maxX && z > minZ && z < maxZ;
}

/**
 * Slab test against a world AABB. Returns entry distance (0 when the origin is
 * inside) or -1 on a miss. Same semantics as util.rayBox, but takes a Box3.
 */
function rayAabb(ox, oy, oz, dx, dy, dz, box, maxDist) {
  let tMin = 0;
  let tMax = maxDist;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [box.min.x, box.min.y, box.min.z];
  const hi = [box.max.x, box.max.y, box.max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (lo[i] - o[i]) * inv;
    let t2 = (hi[i] - o[i]) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }
  return tMin;
}

/** Nearest solid along the ray, clamped to maxDist. Infinity when nothing blocks. */
function castWorld(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (let i = 0; i < colliders.length; i++) {
    if (!asBox(colliders[i], _box)) continue;
    // Cheap reject: skip shells shorter than the ray's height at that spot.
    const t = rayAabb(ox, oy, oz, dx, dy, dz, _box, best);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

/** Clear 2D-ish line of sight at eye height, sampled against collider AABBs. */
function hasSight(colliders, from, to, eyeFrom, eyeTo) {
  const dx = to.x - from.x;
  const dy = eyeTo - eyeFrom;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  return castWorld(colliders, from.x, eyeFrom, from.z, nx, ny, nz, len) >= len - 0.02;
}

export function createShooters(scene, colliders = [], rng = makeRng()) {
  const solids = Array.isArray(colliders) ? colliders.filter(Boolean) : [];
  const list = [];
  // Player->bot hit channel. Registered by update(dt, player, onHit); may also
  // be set directly with setOnHit(). Kept on the closure so the raycast path
  // and the update path report through one function.
  let hitListener = null;
  const R = SHOOTER_TUNING;
  const bounds = { minX: -ARENA.half, maxX: ARENA.half, minZ: -ARENA.half, maxZ: ARENA.half };

  // ---- spawn anchors -----------------------------------------------------
  // Fixed, seeded ring: six slots spread around the yard, nudged out of cover
  // by a short seeded search so a bot never wakes up inside a crate.
  const spawnSlots = [];
  const slotCount = 8;
  for (let i = 0; i < slotCount; i++) {
    const a = (i / slotCount) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const r = rng.range(8.5, 13.0);
    spawnSlots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }

  const clearSpot = (x, z) => {
    // Keep a real body radius of clearance, else the first collide() snaps it.
    for (let i = 0; i < solids.length; i++) {
      const c = solids[i];
      if (boxHeight(c) < 0.25) continue; // floor plates are not obstacles
      if (insideFootprint(x, z, c)) return false;
      const minX = (c.minX ?? c.min?.x) - R.radius;
      const maxX = (c.maxX ?? c.max?.x) + R.radius;
      const minZ = (c.minZ ?? c.min?.z) - R.radius;
      const maxZ = (c.maxZ ?? c.max?.z) + R.radius;
      if (x > minX && x < maxX && z > minZ && z < maxZ) return false;
    }
    return Math.abs(x) < bounds.maxX && Math.abs(z) < bounds.maxZ;
  };

  const findClear = (want, fallbackIndex) => {
    if (clearSpot(want.x, want.z)) return { x: want.x, z: want.z };
    // Spiral out: 16 rings x 12 angles, deterministic.
    for (let ring = 1; ring <= 16; ring++) {
      const rad = ring * 0.6;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + fallbackIndex * 0.31;
        const x = want.x + Math.cos(a) * rad;
        const z = want.z + Math.sin(a) * rad;
        if (clearSpot(x, z)) return { x, z };
      }
    }
    return { x: want.x, z: want.z };
  };

  // Two waypoints per bot, seeded, clear of solids, at least 4 m apart so the
  // walk between them is visible instead of a jitter in place.
  const makeWaypoints = (spawn) => {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(5.0, 9.5);
    let w1 = findClear({ x: spawn.x + Math.cos(a) * r, z: spawn.z + Math.sin(a) * r }, 0);
    let w2 = findClear({ x: spawn.x - Math.cos(a) * r * 0.8, z: spawn.z - Math.sin(a) * r * 0.8 }, 3);
    if (Math.hypot(w1.x - w2.x, w1.z - w2.z) < 4) {
      w2 = findClear({ x: w1.x + 4.5, z: w1.z - 3.0 }, 5);
    }
    return [w1, w2];
  };

  // ---- mesh --------------------------------------------------------------
  const geoCache = {
    torso: new THREE.BoxGeometry(R.torso.w, R.torso.h, R.torso.depth),
    head: new THREE.BoxGeometry(R.head.w, R.head.h, R.head.depth),
    pelvis: new THREE.BoxGeometry(R.pelvis.w, R.pelvis.h, R.pelvis.depth),
    leg: new THREE.BoxGeometry(0.2, R.legs.h, R.legs.depth),
    arm: new THREE.BoxGeometry(0.15, 0.46, 0.16),
    gun: new THREE.BoxGeometry(0.08, 0.11, 0.58),
    visor: new THREE.BoxGeometry(0.3, 0.12, 0.05),
  };

  const buildMesh = (tint) => {
    const g = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0x3b4238, roughness: 0.92, metalness: 0.04 });
    const armor = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.68, metalness: 0.28 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x6b5342, roughness: 0.86 });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x0d1214, roughness: 0.24, metalness: 0.7,
      emissive: 0x2a0a06, emissiveIntensity: 1.2,
    });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1f22, roughness: 0.55, metalness: 0.5 });

    const torso = new THREE.Mesh(geoCache.torso, armor);
    torso.position.y = R.torso.y;
    torso.castShadow = true;
    torso.userData.part = 'torso';
    g.add(torso);

    const pelvis = new THREE.Mesh(geoCache.pelvis, cloth);
    pelvis.position.y = R.pelvis.y;
    pelvis.castShadow = true;
    pelvis.userData.part = 'pelvis';
    g.add(pelvis);

    const legs = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(geoCache.leg, cloth);
      leg.position.set(s * 0.13, R.legs.y, 0);
      leg.castShadow = true;
      leg.userData.part = 'leg';
      g.add(leg);
      legs.push(leg);
    }

    // Separate head mesh on its own node: an independent hit target.
    const head = new THREE.Mesh(geoCache.head, skin);
    head.position.y = R.head.y;
    head.castShadow = true;
    head.userData.part = 'head';
    g.add(head);

    const visor = new THREE.Mesh(geoCache.visor, visorMat);
    visor.position.set(0, R.head.y + 0.02, R.head.depth / 2 + 0.005);
    g.add(visor);

    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(geoCache.arm, cloth);
      arm.position.set(s * 0.36, R.torso.y + 0.06, 0.05);
      arm.rotation.x = -0.9;
      arm.castShadow = true;
      g.add(arm);
    }

    const gun = new THREE.Mesh(geoCache.gun, gunMat);
    gun.position.set(0.18, R.torso.y + 0.02, 0.34);
    g.add(gun);

    // Muzzle flare: a dot that blinks on each shot, so the player can read
    // incoming fire even when the bot is a silhouette.
    const flare = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: 0 })
    );
    flare.position.set(0.18, R.torso.y + 0.02, 0.64);
    g.add(flare);

    return { group: g, head, torso, pelvis, legs, flare, materials: [cloth, armor, skin, visorMat, gunMat] };
  };

  // ---- one bot -----------------------------------------------------------
  const makeBot = (index) => {
    const spawn = findClear(spawnSlots[index % spawnSlots.length], index);
    const waypoints = makeWaypoints(spawn);
    const tint = [0x272c2a, 0x2f2b26, 0x242a2c][index % 3];
    const built = buildMesh(tint);

    const bot = {
      index,
      id: index + 1,
      kind: 'shooter',
      position: new THREE.Vector3(spawn.x, 0, spawn.z),
      velocity: new THREE.Vector3(),
      spawn: { x: spawn.x, z: spawn.z },
      waypoints,
      wpIndex: 0,
      yaw: Math.atan2(spawn.x, spawn.z), // face roughly inward on spawn
      health: 100,
      maxHealth: 100,
      alive: true,
      state: 'patrol',
      fireCooldown: 0,
      respawnTimer: 0,
      deathTimer: 0,
      flash: 0,
      walkPhase: rng.range(0, Math.PI * 2),
      lastHitPoint: new THREE.Vector3(),
      mesh: built.group,
      head: built.head,
      torso: built.torso,
      flare: built.flare,
    };

    bot.head.userData.bot = bot;
    bot.head.userData.head = true;
    bot.torso.userData.bot = bot;

    bot.mesh.position.set(spawn.x, 0, spawn.z);
    bot.mesh.rotation.y = bot.yaw;
    scene?.add?.(bot.mesh);
    return bot;
  };

  for (let i = 0; i < R.count; i++) list.push(makeBot(i));

  // ---- hitboxes ----------------------------------------------------------
  // Rebuilt on demand from live transforms so a bot that is walking/rotating
  // is still hit where it looks like it is.
  const hitBox = (bot, part, out) => {
    const spec = part === 'head' ? R.head : R.torso;
    // Both boxes are near-square in plan, so a yaw-independent AABB sized from
    // the larger side is used: it never under-covers, and it costs no trig per
    // ray. Warp a bot into cover and the box travels with it.
    const half = Math.max(spec.w, spec.depth) / 2;
    const cx = bot.position.x;
    const cz = bot.position.z;
    out.min.set(cx - half, spec.y - spec.h / 2, cz - half);
    out.max.set(cx + half, spec.y + spec.h / 2, cz + half);
    return out;
  };

  // ---- collision ---------------------------------------------------------
  /**
   * Axis-by-axis depenetration against every solid AABB. X is resolved first,
   * then Z, so a body pressed into a corner slides along the wall it hit first
   * instead of being ejected diagonally.
   */
  const collide = (bot, dt) => {
    const r = R.radius;
    let nextX = bot.position.x + bot.velocity.x * dt;
    let nextZ = bot.position.z + bot.velocity.z * dt;

    // X pass
    for (let i = 0; i < solids.length; i++) {
      const col = solids[i];
      if (boxHeight(col) < 0.25) continue;
      const minX = (col.minX ?? col.min?.x) - r;
      const maxX = (col.maxX ?? col.max?.x) + r;
      const minZ = (col.minZ ?? col.min?.z) - r;
      const maxZ = (col.maxZ ?? col.max?.z) + r;
      if (nextZ <= minZ || nextZ >= maxZ) continue; // no overlap on this axis
      const footY = col.minY ?? col.min?.y ?? 0;
      if (footY > R.height) continue; // solid starts above the body
      if (nextX > minX && nextX < maxX) {
        // Push out toward whichever X face is nearer.
        nextX = bot.position.x >= (minX + maxX) / 2 ? maxX : minX;
        bot.velocity.x = 0;
      }
    }

    // Z pass (using the already-resolved X)
    for (let i = 0; i < solids.length; i++) {
      const col = solids[i];
      if (boxHeight(col) < 0.25) continue;
      const minX = (col.minX ?? col.min?.x) - r;
      const maxX = (col.maxX ?? col.max?.x) + r;
      const minZ = (col.minZ ?? col.min?.z) - r;
      const maxZ = (col.maxZ ?? col.max?.z) + r;
      if (nextX <= minX || nextX >= maxX) continue;
      const footY = col.minY ?? col.min?.y ?? 0;
      if (footY > R.height) continue;
      if (nextZ > minZ && nextZ < maxZ) {
        nextZ = bot.position.z >= (minZ + maxZ) / 2 ? maxZ : minZ;
        bot.velocity.z = 0;
      }
    }

    // Arena walls are the last word: the body never leaves the yard.
    bot.position.x = Math.min(bounds.maxX, Math.max(bounds.minX, nextX));
    bot.position.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, nextZ));
  };

  // ---- behaviour ---------------------------------------------------------
  const playerEye = (player) => {
    if (!player) return 1.62;
    if (typeof player.eyeHeight === 'number') return player.eyeHeight;
    if (player.camera) return player.camera.position.y;
    return 1.62;
  };

  const playerPoint = (player) => {
    // Aim for centre mass at the player's own eye height, not their feet.
    const y = playerEye(player);
    return { x: player.position.x, y: y - 0.12, z: player.position.z, eye: y };
  };

  const distanceTo = (bot, player) =>
    Math.hypot(player.position.x - bot.position.x, player.position.z - bot.position.z);

  const tryRespawn = (bot, dt, player) => {
    bot.respawnTimer -= dt;
    if (bot.respawnTimer > 0) return;
    // Seeded spawn point: nearest slot that is clear AND not on top of the player.
    const order = [];
    for (let i = 0; i < spawnSlots.length; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    let chosen = findClear(spawnSlots[order[0]], order[0]);
    for (const oi of order) {
      const p = findClear(spawnSlots[oi], oi);
      const dp = player ? Math.hypot(p.x - player.position.x, p.z - player.position.z) : 99;
      if (dp > 7) { chosen = p; break; }
    }
    bot.position.set(chosen.x, 0, chosen.z);
    bot.spawn = { x: chosen.x, z: chosen.z };
    bot.velocity.set(0, 0, 0);
    bot.waypoints = makeWaypoints(chosen);
    bot.wpIndex = 0;
    bot.health = bot.maxHealth;
    bot.alive = true;
    bot.state = 'patrol';
    bot.deathTimer = 0;
    bot.fireCooldown = rng.range(R.fireMin, R.fireMax);
    bot.mesh.visible = true;
    bot.mesh.position.set(chosen.x, 0, chosen.z);
    bot.mesh.rotation.set(0, bot.yaw, 0);
  };

  const patrol = (bot, dt) => {
    const wp = bot.waypoints[bot.wpIndex % bot.waypoints.length];
    const dx = wp.x - bot.position.x;
    const dz = wp.z - bot.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) {
      bot.wpIndex = (bot.wpIndex + 1) % bot.waypoints.length;
    } else {
      const nx = dx / d;
      const nz = dz / d;
      bot.velocity.x = nx * R.walkSpeed;
      bot.velocity.z = nz * R.walkSpeed;
      const face = Math.atan2(nx, nz); // yaw where local +Z points along the step
      bot.yaw += shortestAngle(bot.yaw, face) * Math.min(1, dt * R.turnRate);
    }
  };

  const fireAt = (bot, player, point, onShot) => {
    const eye = R.torso.y + 0.12;
    const dx = point.x - bot.position.x;
    const dy = point.y - eye;
    const dz = point.z - bot.position.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Clear raycast: cover eats the bullet, no damage is applied.
    const solidT = castWorld(solids, bot.position.x, eye, bot.position.z, nx, ny, nz, dist);
    const blocked = solidT < dist - 0.05;

    bot.flash = 1;
    // Cosmetic hook only (muzzle flash, sound, tracer); the damage below is
    // applied here, so a rig that ignores onShot still takes the hit.
    if (onShot) onShot(bot, blocked ? 'blocked' : 'hit');

    if (blocked) return;

    const dmg = rng.range(R.damageMin, R.damageMax);
    if (player && typeof player.hurt === 'function') player.hurt(dmg, bot.position);
  };

  const update = (dt, player, onHit, onShot) => {
    if (typeof onHit === 'function') hitListener = onHit;
    const step = Math.max(0, Math.min(0.1, dt || 0));
    if (step === 0) return;

    for (let i = 0; i < list.length; i++) {
      const bot = list[i];

      // --- dead: count down, then respawn -------------------------------
      if (!bot.alive) {
        bot.deathTimer += step;
        bot.flash = Math.max(0, bot.flash - step * 4);
        tryRespawn(bot, step, player);
        continue;
      }

      // --- occlusion blink -----------------------------------------------
      if (bot.flash > 0) {
        bot.flash = Math.max(0, bot.flash - step * 5.5);
        bot.flare.material.opacity = bot.flash;
      }

      if (!player || player.alive === false) {
        // No valid target: walk the route. patrol() owns the velocity, so it
        // must not be zeroed here or the bot freezes on its waypoint.
        bot.state = 'patrol';
        patrol(bot, step);
        collide(bot, step);
        syncMesh(bot, step);
        continue;
      }

      const point = playerPoint(player);
      const eye = R.torso.y + 0.12;
      const dist = distanceTo(bot, player);
      const inRange = dist <= R.viewRange;
      const sees = inRange && hasSight(solids, bot.position, point, eye, point.eye);

      if (sees) {
        bot.state = 'engage';
        // Stop dead: shooters plant their feet to fire.
        bot.velocity.x = 0;
        bot.velocity.z = 0;

        // Face the player before the shot is allowed to leave the barrel.
        const face = Math.atan2(point.x - bot.position.x, point.z - bot.position.z);
        bot.yaw += shortestAngle(bot.yaw, face) * Math.min(1, step * R.turnRate);

        bot.fireCooldown -= step;
        if (bot.fireCooldown <= 0) {
          fireAt(bot, player, point, onShot);
          bot.fireCooldown = rng.range(R.fireMin, R.fireMax);
        }
      } else {
        bot.state = 'patrol';
        bot.fireCooldown = Math.max(bot.fireCooldown, 0.15);
        patrol(bot, step);
      }

      collide(bot, step);
      syncMesh(bot, step);
    }
  };

  const syncMesh = (bot, dt) => {
    bot.mesh.position.set(bot.position.x, 0, bot.position.z);
    bot.mesh.rotation.y = bot.yaw;
    const planar = Math.hypot(bot.velocity.x, bot.velocity.z);
    bot.walkPhase += dt * (3.0 + planar * 3.4);
    const swing = Math.sin(bot.walkPhase) * Math.min(1, planar / R.walkSpeed) * 0.5;
    if (bot.mesh.children) {
      let legIdx = 0;
      for (const child of bot.mesh.children) {
        if (child.userData.part === 'leg') {
          child.rotation.x = legIdx === 0 ? swing : -swing;
          legIdx++;
        }
      }
    }
  };

  /**
   * Ray vs every live bot. Nearest torso/head entry wins; head hitboxes are
   * tested first so a grazing headshot is not stolen by the torso behind it.
   * Returns null when nothing is hit (the caller draws the wall impact).
   */
  const raycast = (origin, dir, maxDist = 140) => {
    let best = { bot: null, dist: Infinity, point: null, isHead: false };
    for (let i = 0; i < list.length; i++) {
      const bot = list[i];
      if (!bot.alive) continue;
      for (const part of ['head', 'torso']) {
        hitBox(bot, part, _box);
        const t = rayAabb(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, _box, Math.min(maxDist, best.dist));
        if (t >= 0 && t < best.dist) {
          best = {
            bot,
            dist: t,
            point: {
              x: origin.x + dir.x * t,
              y: origin.y + dir.y * t,
              z: origin.z + dir.z * t,
            },
            isHead: part === 'head',
          };
        }
      }
    }
    if (!best.bot) return null;
    best.point = new THREE.Vector3(best.point.x, best.point.y, best.point.z);
    return best;
  };

  /**
   * Apply damage from one player bullet.
   * Resolves the kill/respawn bookkeeping AND fires onHit(bot, point, isHead):
   * this is the player->bot channel the brief asks update() to expose, so the
   * caller never has to remember to report the hit itself.
   */
  const damage = (bot, amount, isHead = false, point = null) => {
    if (!bot || !bot.alive) return { killed: false, damage: 0, isHead: !!isHead };
    const where = point
      ? new THREE.Vector3(point.x, point.y, point.z)
      : new THREE.Vector3(bot.position.x, isHead ? R.head.y : R.torso.y, bot.position.z);
    bot.health -= amount;
    bot.lastHitPoint.copy(where);
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.deathTimer = 0;
      bot.respawnTimer = R.respawnTime;
      bot.velocity.set(0, 0, 0);
      bot.mesh.visible = false;
      // Corpse marker: the group is hidden, but the head keeps the last point
      // so effects (blood decals, ragdoll hooks) still have something to read.
      bot.mesh.position.set(bot.position.x, -50, bot.position.z);
      if (hitListener) hitListener(bot, where, !!isHead);
      return { killed: true, damage: amount, isHead: !!isHead, point: where };
    }
    if (hitListener) hitListener(bot, where, !!isHead);
    return { killed: false, damage: amount, isHead: !!isHead, point: where };
  };

  /**
   * Resolve one player bullet end to end: hit-race against the bots, world
   * occlusion, damage, onHit. Returns null when nothing bot-shaped was hit.
   */
  const applyPlayerHit = (origin, dir, amount, maxDist = 140, opts = {}) => {
    const hit = raycast(origin, dir, maxDist);
    if (!hit) return null;
    const world = raycastWorld(origin, dir, maxDist);
    if (world && world.dist < hit.dist - 0.02) return null; // cover ate it
    const dmg = amount * (hit.isHead ? (opts.headMul ?? 1) : 1);
    const res = damage(hit.bot, dmg, hit.isHead, hit.point);
    return { ...res, bot: hit.bot, dist: hit.dist, point: hit.point, isHead: hit.isHead };
  };

  const setOnHit = (fn) => {
    hitListener = typeof fn === 'function' ? fn : null;
  };

  const reset = () => {
    for (let i = 0; i < list.length; i++) {
      const bot = list[i];
      const spawn = findClear(spawnSlots[i % spawnSlots.length], i);
      bot.position.set(spawn.x, 0, spawn.z);
      bot.spawn = { x: spawn.x, z: spawn.z };
      bot.waypoints = makeWaypoints(spawn);
      bot.wpIndex = 0;
      bot.velocity.set(0, 0, 0);
      bot.health = bot.maxHealth;
      bot.alive = true;
      bot.state = 'patrol';
      bot.deathTimer = 0;
      bot.respawnTimer = 0;
      bot.fireCooldown = rng.range(R.fireMin, R.fireMax);
      bot.flash = 0;
      bot.flare.material.opacity = 0;
      bot.mesh.visible = true;
      bot.mesh.position.set(spawn.x, 0, spawn.z);
      bot.mesh.rotation.set(0, bot.yaw, 0);
      syncMesh(bot, 0);
    }
  };

  const raycastWorld = (origin, dir, maxDist = 140) => {
    const t = castWorld(solids, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist);
    if (!isFinite(t) || t >= maxDist) return null;
    return { dist: t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) };
  };

  const aliveCount = () => list.reduce((n, b) => n + (b.alive ? 1 : 0), 0);

  return { list, update, raycast, raycastWorld, damage, applyPlayerHit, setOnHit, reset, aliveCount, bounds, tuning: R };
}

/** Signed shortest rotation from `from` to `to`, in (-PI, PI]. */
function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

