import * as THREE from 'three';
import { COLORS } from './config.js';
import { makeSurfaceTexture, pointBlocked, clamp } from './util.js';

/**
 * The range: a walled concrete compound with an open yard, a two-storey block,
 * shipping containers and stacked crates. Everything is boxes and planes built
 * in code. The same pass that creates meshes records AABB colliders, which are
 * reused for body collision, bullet line-of-sight and the navigation grid.
 */
export function buildArena(rng) {
  const group = new THREE.Group();
  group.name = 'arena';
  const colliders = []; // { minX, maxX, minZ, maxZ, minY, maxY }
  const lamps = [];

  const SIZE = 34; // half-extent of the yard floor
  const WALL_H = 7.5;

  const sandTex = makeSurfaceTexture(rng, 'sand', COLORS.sand, { repeat: [18, 18] });
  const concreteTex = makeSurfaceTexture(rng, 'concrete', COLORS.concrete, { repeat: [2, 1] });
  const concreteDarkTex = makeSurfaceTexture(rng, 'concrete', COLORS.concreteDark, { repeat: [2, 2] });
  const steelTex = makeSurfaceTexture(rng, 'steel', COLORS.steel, { repeat: [3, 2] });

  const matSand = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1.0, metalness: 0.0 });
  const matConcrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.94, metalness: 0.03 });
  const matConcreteDark = new THREE.MeshStandardMaterial({ map: concreteDarkTex, roughness: 0.96, metalness: 0.02 });
  const matSteel = new THREE.MeshStandardMaterial({ map: steelTex, roughness: 0.62, metalness: 0.45 });
  const matRust = new THREE.MeshStandardMaterial({ map: steelTex, color: COLORS.rust, roughness: 0.86, metalness: 0.2 });
  const matOlive = new THREE.MeshStandardMaterial({ map: steelTex, color: COLORS.olive, roughness: 0.8, metalness: 0.15 });
  const matHazard = new THREE.MeshStandardMaterial({ color: COLORS.hazard, roughness: 0.7, metalness: 0.1 });
  const matAccent = new THREE.MeshBasicMaterial({ color: COLORS.accent });

  // ---------- ground ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(SIZE * 2, SIZE * 2), matSand);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Concrete apron in the middle so the eye has a reference under the feet.
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(26, 20), matConcreteDark);
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.012, 4);
  apron.receiveShadow = true;
  group.add(apron);

  // Hazard stripes down the firing line: alternating blocks, flat on the deck.
  const stripeGeo = new THREE.PlaneGeometry(2.0, 0.7);
  for (let i = 0; i < 13; i++) {
    if (i % 2 !== 0) continue;
    const s = new THREE.Mesh(stripeGeo, matHazard);
    s.rotation.x = -Math.PI / 2;
    s.position.set(-25 + i * 2.0 + 1.0, 0.02, 12.2);
    group.add(s);
  }

  // ---------- helpers ----------
  const addBox = (w, h, d, x, y, z, mat, { solid = true, rotY = 0, top = 0 } = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      // Rotated boxes are still recorded as their axis-aligned bound, which is a
      // deliberate simplification: cover reads as cover for collision.
      const c = Math.abs(Math.cos(rotY));
      const s = Math.abs(Math.sin(rotY));
      const ex = (w * c + d * s) / 2;
      const ez = (w * s + d * c) / 2;
      colliders.push({
        minX: x - ex, maxX: x + ex,
        minZ: z - ez, maxZ: z + ez,
        minY: y, maxY: y + h + top,
      });
    }
    return mesh;
  };

  // ---------- perimeter ----------
  const wallT = 1.4;
  // North wall with a gate gap.
  addBox(SIZE * 2, WALL_H, wallT, 0, 0, -SIZE, matConcrete);
  addBox(wallT, WALL_H, SIZE * 2, -SIZE, 0, 0, matConcrete);
  addBox(wallT, WALL_H, SIZE * 2, SIZE, 0, 0, matConcrete);
  // South wall split by the entry gate.
  addBox(SIZE - 3, WALL_H, wallT, -(SIZE + 3) / 2, 0, SIZE, matConcrete);
  addBox(SIZE - 3, WALL_H, wallT, (SIZE + 3) / 2, 0, SIZE, matConcrete);

  // Wall buttresses: rhythm along the perimeter and extra silhouette.
  for (let i = -3; i <= 3; i++) {
    addBox(1.0, WALL_H * 0.62, 0.9, i * 9, 0, -SIZE + 1.1, matConcreteDark);
    addBox(0.9, WALL_H * 0.5, 1.0, -SIZE + 1.1, 0, i * 9, matConcreteDark);
    addBox(0.9, WALL_H * 0.5, 1.0, SIZE - 1.1, 0, i * 9, matConcreteDark);
  }

  // ---------- the block (west side, two storeys) ----------
  const bx = -19;
  const bz = -8;
  addBox(13, 3.4, 10, bx, 0, bz, matConcreteDark); // ground floor shell
  addBox(13, 0.35, 10, bx, 3.4, bz, matConcrete, { solid: false }); // slab
  addBox(13, 3.0, 10, bx, 3.75, bz, matConcrete, { solid: false, top: 0 });
  addBox(13.4, 0.4, 10.4, bx, 6.75, bz, matConcreteDark, { solid: false }); // roof cap

  // Rooftop railing + a light mast, so the block reads as a landmark.
  for (let i = 0; i < 7; i++) {
    addBox(0.18, 1.0, 0.18, bx - 6 + i * 2, 7.15, bz + 4.8, matSteel, { solid: false });
  }
  addBox(12.6, 0.1, 0.14, bx, 8.05, bz + 4.8, matSteel, { solid: false });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5.4, 8), matSteel);
  mast.position.set(bx + 4.4, 7.0 + 2.7, bz - 3.2);
  mast.castShadow = true;
  group.add(mast);
  const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.9), matAccent);
  lampHead.position.set(bx + 4.4, 12.5, bz - 3.2);
  group.add(lampHead);
  lamps.push({ position: new THREE.Vector3(bx + 4.4, 12.2, bz - 3.0), color: 0xbfe9ff, intensity: 55, distance: 34 });

  // Block windows: emissive quads so the building is not a black slab.
  const winMat = new THREE.MeshBasicMaterial({ color: 0x33475a });
  const litWinMat = new THREE.MeshBasicMaterial({ color: 0x8fd3ef });
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), (r + c) % 5 === 1 ? litWinMat : winMat);
      w.position.set(bx - 5 + c * 3.4, 1.7 + r * 3.5, bz + 5.02);
      group.add(w);
    }
  }

  // ---------- shipping containers ----------
  const containers = [
    { x: 8, z: -14, rotY: 0.0, mat: matRust },
    { x: 14.5, z: -6, rotY: 0.35, mat: matOlive },
    { x: 2, z: -18.5, rotY: 0.0, mat: matSteel },
    { x: -3, z: 2, rotY: -0.22, mat: matOlive },
    { x: 17, z: 9, rotY: 1.57, mat: matRust },
  ];
  for (const c of containers) {
    addBox(6.1, 2.6, 2.5, c.x, 0, c.z, c.mat, { rotY: c.rotY });
    // Corrugation ribs.
    const ribs = 7;
    for (let i = 0; i < ribs; i++) {
      const off = -2.3 + (i * 4.6) / (ribs - 1);
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.4, 2.56), matSteel);
      rib.position.set(c.x + Math.cos(c.rotY) * off, 1.3, c.z - Math.sin(c.rotY) * off);
      rib.rotation.y = c.rotY;
      group.add(rib);
    }
  }

  // ---------- crate stacks (procedural but seeded) ----------
  const crateMat = new THREE.MeshStandardMaterial({ map: steelTex, color: 0x8a7458, roughness: 0.85, metalness: 0.08 });
  const crateSlots = [
    [-8, 8], [-6.4, 8], [-8, 6.4],
    [6, 6], [7.6, 6], [7.6, 7.6],
    [-13, 14], [-11.4, 14],
    [12, 14], [13.6, 14], [12, 15.6],
    [-1.5, -4], [-1.5, -5.6],
    [9, -2], [10.6, -2],
    [-15, 1], [-15, -0.6],
  ];
  for (const [x, z] of crateSlots) {
    const s = 1.55;
    const yaw = rng.range(-0.16, 0.16);
    addBox(s, s, s, x, 0, z, crateMat, { rotY: yaw });
    if (rng.chance(0.45)) addBox(s * 0.78, s * 0.78, s * 0.78, x + rng.range(-0.12, 0.12), s, z + rng.range(-0.12, 0.12), crateMat, { rotY: yaw + 0.3, solid: false });
  }

  // ---------- low barriers across the yard ----------
  const barrierSpots = [
    [-4, 13.5, 5.2, 0.05],
    [3.5, 10.5, 4.4, -0.14],
    [-10, 5.0, 3.6, 1.4],
    [10.5, 1.0, 4.0, 0.6],
  ];
  for (const [x, z, w, rotY] of barrierSpots) {
    addBox(w, 1.15, 0.55, x, 0, z, matConcrete, { rotY });
    // Jersey-barrier taper.
    addBox(w * 0.96, 0.22, 0.34, x, 1.15, z, matConcreteDark, { rotY, solid: false });
  }

  // ---------- barrels ----------
  const barrelMat = new THREE.MeshStandardMaterial({ map: steelTex, color: 0xb87c2e, roughness: 0.7, metalness: 0.3 });
  const barrelSpots = [[-11.5, 10.5], [5.2, -8.5], [16, 2], [-6.5, -12], [1.5, 8]];
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14);
  for (const [x, z] of barrelSpots) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.525, z);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    colliders.push({ minX: x - 0.42, maxX: x + 0.42, minZ: z - 0.42, maxZ: z + 0.42, minY: 0, maxY: 1.05 });
  }

  // ---------- entry gate frame (south), sealed ----------
  addBox(0.6, 4.4, 0.6, -2.8, 0, SIZE - 0.4, matSteel);
  addBox(0.6, 4.4, 0.6, 2.8, 0, SIZE - 0.4, matSteel);
  addBox(6.2, 0.5, 0.7, 0, 4.4, SIZE - 0.4, matSteel, { solid: false });
  // The gate itself is welded shut: the yard is the only playable space, so the
  // gap in the wall must not be a hole you can walk out of.
  addBox(5.6, WALL_H, 1.2, 0, 0, SIZE, matSteel);
  for (let i = 0; i < 9; i++) {
    addBox(0.12, WALL_H - 0.2, 0.14, -2.5 + i * 0.62, 0.1, SIZE - 0.66, matConcreteDark, { solid: false });
  }
  const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.9), new THREE.MeshBasicMaterial({ color: 0x1a2229 }));
  gateSign.position.set(0, 3.4, SIZE - 1.06);
  gateSign.rotation.y = Math.PI;
  group.add(gateSign);

  // ---------- lighting ----------
  const hemi = new THREE.HemisphereLight(0xa9c8e4, 0x4a3f2e, 0.85);
  group.add(hemi);

  const moon = new THREE.DirectionalLight(0xd6e6ff, 1.9);
  moon.position.set(-26, 34, 20);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 110;
  moon.shadow.camera.left = -44;
  moon.shadow.camera.right = 44;
  moon.shadow.camera.top = 44;
  moon.shadow.camera.bottom = -44;
  moon.shadow.bias = -0.0009;
  moon.shadow.normalBias = 0.02;
  group.add(moon);

  // Floodlights around the yard: warm pools that break up the darkness.
  const floodSpots = [
    { x: -14, z: 16, c: 0xffb066 },
    { x: 15, z: -16, c: 0xa8d8ff },
    { x: 0, z: -6, c: 0xffd9a0 },
    { x: -32, z: -30, c: 0xff9a5c },
  ];
  for (const f of floodSpots) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.19, 6.2, 8), matSteel);
    pole.position.set(f.x, 3.1, f.z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.5), new THREE.MeshBasicMaterial({ color: f.c }));
    head.position.set(f.x, 6.25, f.z);
    group.add(head);
    lamps.push({ position: new THREE.Vector3(f.x, 6.1, f.z), color: f.c, intensity: 30, distance: 26 });
  }
  for (const l of lamps) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, 2.0);
    pl.position.copy(l.position);
    group.add(pl);
  }

  // Sky dome: vertical gradient, no external texture.
  // Gradient sky as a 1x256 canvas texture on a plain basic material: no custom
  // shader, so three's own colour management and tone mapping apply consistently.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 2;
  skyCanvas.height = 256;
  const sctx = skyCanvas.getContext('2d');
  const grad = sctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#0a1420'); // zenith
  grad.addColorStop(0.42, '#233c4f');
  grad.addColorStop(0.58, '#5c7d92');
  grad.addColorStop(0.72, '#9db4c0'); // horizon haze
  grad.addColorStop(1.0, '#2a3138'); // below horizon (never really seen)
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.magFilter = THREE.LinearFilter;
  skyTex.minFilter = THREE.LinearFilter;

  const skyGeo = new THREE.SphereGeometry(260, 32, 20);
  const skyMat = new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = 10000;
  sky.frustumCulled = false;
  group.add(sky);

  // Distant hills so the horizon is not a hard line above the walls.
  const hillMat = new THREE.MeshBasicMaterial({ color: 0x1d2c36 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 120 + rng.range(-18, 18);
    const h = new THREE.Mesh(new THREE.ConeGeometry(rng.range(22, 44), rng.range(9, 22), 5), hillMat);
    h.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
    h.rotation.y = rng.next() * Math.PI;
    group.add(h);
  }

  // ---------- navigation grid ----------
  // Coarse grid (1m cells) over the walkable yard, marked by the same colliders
  // the bodies use. A* runs on this, so enemies route around cover instead of
  // grinding into it.
  const NAV_MIN = -SIZE + 2;
  const NAV_MAX = SIZE - 2;
  const CELL = 1.0;
  const N = Math.round((NAV_MAX - NAV_MIN) / CELL);
  const blocked = new Uint8Array(N * N);
  const navRadius = 0.55;
  for (let gz = 0; gz < N; gz++) {
    for (let gx = 0; gx < N; gx++) {
      const wx = NAV_MIN + (gx + 0.5) * CELL;
      const wz = NAV_MIN + (gz + 0.5) * CELL;
      blocked[gz * N + gx] = pointBlocked(wx, wz, navRadius, colliders) ? 1 : 0;
    }
  }

  const grid = {
    min: NAV_MIN,
    max: NAV_MAX,
    cell: CELL,
    n: N,
    blocked,
    toCell(x, z) {
      return {
        gx: clamp(Math.floor((x - NAV_MIN) / CELL), 0, N - 1),
        gz: clamp(Math.floor((z - NAV_MIN) / CELL), 0, N - 1),
      };
    },
    toWorld(gx, gz) {
      return { x: NAV_MIN + (gx + 0.5) * CELL, z: NAV_MIN + (gz + 0.5) * CELL };
    },
    isBlocked(gx, gz) {
      if (gx < 0 || gz < 0 || gx >= N || gz >= N) return true;
      return blocked[gz * N + gx] === 1;
    },
    isFreeWorld(x, z) {
      const c = this.toCell(x, z);
      return !this.isBlocked(c.gx, c.gz);
    },
  };

  const findPath = (from, to) => aStar(grid, from, to);

  // Candidate spawn points: gate side plus the far corners.
  const spawnPoints = [
    { x: -1.5, z: -27.5 }, { x: 20, z: -25 }, { x: -24, z: -24 },
    { x: 24, z: 4 }, { x: -26, z: 8 }, { x: 6, z: -27 }, { x: 0.5, z: -20.5 },
    { x: -18, z: 24 }, { x: 18, z: 22 }, { x: 27, z: -12 }, { x: -27, z: -6 },
    { x: 8, z: 26 }, { x: -8, z: -30 }, { x: 26, z: 26 },
  ].filter((p) => grid.isFreeWorld(p.x, p.z));

  const patrolPoints = [
    { x: -8, z: -12 }, { x: 4, z: -8 }, { x: 12, z: -16 }, { x: -16, z: 4 },
    { x: 14, z: 12 }, { x: -2, z: 14 }, { x: -20, z: -18 }, { x: 18, z: -2 },
    { x: -14, z: -2 }, { x: 8, z: 18 },
  ].filter((p) => grid.isFreeWorld(p.x, p.z));

  return { group, colliders, spawnPoints, patrolPoints, grid, findPath, bounds: { size: SIZE } };
}

/** True if the segment a->b is blocked by any collider (2D, sampled). */
export function segmentBlocked(ax, az, bx, bz, colliders) {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.ceil(dist / 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    for (let c = 0; c < colliders.length; c++) {
      const col = colliders[c];
      if (col.maxY < 1.0) continue; // waist-high cover does not block a standing shot
      if (x > col.minX && x < col.maxX && z > col.minZ && z < col.maxZ) return true;
    }
  }
  return false;
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
];

/** A* on the nav grid. Bounded node budget keeps a bad path from stalling a frame. */
export function aStar(grid, from, to, maxNodes = 2600) {
  const start = grid.toCell(from.x, from.z);
  const goal = grid.toCell(to.x, to.z);
  const n = grid.n;
  const idx = (gx, gz) => gz * n + gx;
  const startI = idx(start.gx, start.gz);
  const goalI = idx(goal.gx, goal.gz);

  const open = [startI];
  const inOpen = new Set(open);
  const came = new Int32Array(n * n).fill(-1);
  const gScore = new Float32Array(n * n).fill(Infinity);
  const fScore = new Float32Array(n * n).fill(Infinity);
  gScore[startI] = 0;
  const h = (gx, gz) => Math.hypot(gx - goal.gx, gz - goal.gz);
  fScore[startI] = h(start.gx, start.gz);

  let nodes = 0;
  while (open.length && nodes < maxNodes) {
    // Linear pop of the best f: N is small (66x66) and clarity beats a heap here.
    let bestAt = 0;
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bestAt]]) bestAt = i;
    const current = open.splice(bestAt, 1)[0];
    inOpen.delete(current);
    nodes++;

    if (current === goalI) {
      const path = [];
      let c = current;
      while (c !== -1) {
        path.push(grid.toWorld(c % n, Math.floor(c / n)));
        c = came[c];
      }
      path.reverse();
      return path;
    }

    const cgx = current % n;
    const cgz = Math.floor(current / n);
    for (const [dx, dz, cost] of DIRS) {
      const nx = cgx + dx;
      const nz = cgz + dz;
      if (grid.isBlocked(nx, nz)) continue;
      // No corner cutting through diagonal gaps.
      if (dx !== 0 && dz !== 0) {
        if (grid.isBlocked(cgx + dx, cgz) || grid.isBlocked(cgx, cgz + dz)) continue;
      }
      const ni = idx(nx, nz);
      const tentative = gScore[current] + cost;
      if (tentative < gScore[ni]) {
        came[ni] = current;
        gScore[ni] = tentative;
        fScore[ni] = tentative + h(nx, nz);
        if (!inOpen.has(ni)) {
          open.push(ni);
          inOpen.add(ni);
        }
      }
    }
  }
  return null;
}
