import * as THREE from 'three';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Frame-rate independent smoothing. */
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const TAU = Math.PI * 2;

/** Shortest signed angle difference in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Push a circle (x,z,radius) out of every AABB it overlaps.
 * Colliders are axis-aligned boxes with a Y range so low crates still stop the body.
 * Two passes settle corners without jitter.
 */
export function resolveCircle(pos, radius, colliders, bodyTop = 1.8, bodyBottom = 0.0) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.maxY <= bodyBottom || c.minY >= bodyTop) continue;
      const nearestX = clamp(pos.x, c.minX, c.maxX);
      const nearestZ = clamp(pos.z, c.minZ, c.maxZ);
      let dx = pos.x - nearestX;
      let dz = pos.z - nearestZ;
      let d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;

      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (dx / d) * push;
        pos.z += (dz / d) * push;
      } else {
        // Centre is inside the box: exit along the shallowest axis.
        const toMinX = pos.x - c.minX;
        const toMaxX = c.maxX - pos.x;
        const toMinZ = pos.z - c.minZ;
        const toMaxZ = c.maxZ - pos.z;
        const m = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
        if (m === toMinX) pos.x = c.minX - radius;
        else if (m === toMaxX) pos.x = c.maxX + radius;
        else if (m === toMinZ) pos.z = c.minZ - radius;
        else pos.z = c.maxZ + radius;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return pos;
}

/** Is a point inside any collider footprint (inflated by radius)? */
export function pointBlocked(x, z, radius, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (x > c.minX - radius && x < c.maxX + radius && z > c.minZ - radius && z < c.maxZ + radius) {
      return true;
    }
  }
  return false;
}

const textureCache = new Map();

/**
 * Procedural canvas texture. No image files: grain, scratches and seams are drawn
 * with the seeded generator, so the range looks weathered on every load.
 */
export function makeSurfaceTexture(rng, kind, baseColor, options = {}) {
  const key = `${kind}:${baseColor}:${options.tint ?? ''}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const size = options.size ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const base = new THREE.Color(baseColor);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(0, 0, size, size);

  // Broad tonal blotches.
  const blotches = kind === 'sand' ? 90 : 55;
  for (let i = 0; i < blotches; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const r = rng.range(size * 0.02, size * 0.16);
    const shade = rng.range(-0.16, 0.16);
    const c = base.clone().offsetHSL(0, 0, shade);
    ctx.fillStyle = `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${rng.range(0.05, 0.2)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.5, 1.5), rng.next() * TAU, 0, TAU);
    ctx.fill();
  }

  // Fine grain.
  const dots = kind === 'sand' ? 5200 : 3400;
  for (let i = 0; i < dots; i++) {
    const v = rng.range(-0.5, 0.5);
    const c = v > 0 ? '#ffffff' : '#000000';
    ctx.fillStyle = `rgba(${c === '#ffffff' ? '255,255,255' : '0,0,0'},${Math.abs(v) * 0.09})`;
    ctx.fillRect(rng.next() * size, rng.next() * size, 1, 1);
  }

  if (kind === 'concrete') {
    // Panel seams.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const p = (size / 4) * i;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    // Hairline cracks.
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      let x = rng.next() * size;
      let y = rng.next() * size;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += rng.range(-22, 22);
        y += rng.range(-22, 22);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  if (kind === 'steel') {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 40; i++) {
      const y = rng.next() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + rng.range(-3, 3));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,70,40,0.16)';
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.ellipse(rng.next() * size, rng.next() * size, rng.range(4, 26), rng.range(3, 18), rng.next() * TAU, 0, TAU);
      ctx.fill();
    }
  }

  if (kind === 'sand') {
    // Tyre-ish scuffs across the yard.
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 6;
    for (let i = 0; i < 10; i++) {
      const y = rng.next() * size;
      ctx.beginPath();
      ctx.moveTo(-10, y);
      ctx.bezierCurveTo(size * 0.3, y + rng.range(-18, 18), size * 0.7, y + rng.range(-18, 18), size + 10, y + rng.range(-24, 24));
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (options.repeat) tex.repeat.set(options.repeat[0], options.repeat[1]);
  textureCache.set(key, tex);
  return tex;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Deterministic randomness + ray/AABB helpers.
 * Everything below is pure: no imports, no globals, no side effects.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Seeded PRNG factory (mulberry32). Same seed, same stream, every run.
 * @param {number} seed 32-bit seed
 * @returns {{ next: () => number, range: (a:number,b:number) => number, pick: <T>(arr:T[]) => T }}
 */
export function rng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    pick: (arr) => arr[Math.min(arr.length - 1, Math.floor(next() * arr.length))],
  };
}

/**
 * Slab test against an axis-aligned box.
 * @param {{x:number,y:number,z:number}} origin ray origin
 * @param {{x:number,y:number,z:number}} dir    direction (need not be normalised)
 * @param {{min:{x,y,z}, max:{x,y,z}}} box      THREE.Box3-shaped
 * @returns {number} distance along dir to the first face, 0 if the origin is
 *                   inside the box, or -1 when the ray misses / box is behind.
 */
export function rayBox(origin, dir, box) {
  const axes = ['x', 'y', 'z'];
  let tMin = -Infinity;
  let tMax = Infinity;

  for (let i = 0; i < 3; i++) {
    const ax = axes[i];
    const o = origin[ax];
    const d = dir[ax];
    const lo = box.min[ax];
    const hi = box.max[ax];

    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1; // parallel and outside the slab
      continue;
    }

    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return -1;
  }

  if (tMax < 0) return -1; // box is entirely behind the origin
  return tMin >= 0 ? tMin : 0; // origin inside -> entry distance 0
}
