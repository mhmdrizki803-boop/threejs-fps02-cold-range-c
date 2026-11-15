import * as THREE from 'three';

/**
 * Arena construction.
 *
 * Everything here is driven by the rng passed in, so the same seed always
 * builds the same yard: same crate sizes, same pillars, same ramp angles.
 * Every solid that should stop a body is ALSO pushed into `colliders` as a
 * world-space THREE.Box3 - the render meshes and the physics hulls are built
 * from the same numbers, so what you see is what you hit.
 */

export const ARENA = {
  size: 40, // outer footprint, metres
  half: 20,
  wallHeight: 6,
  wallThickness: 1,
  spawnClear: 3.0, // keep the middle of the south edge open for spawns
};

const PALETTE = {
  sky: 0x0b1016,
  fog: 0x23303a,
  sand: 0x7d7160,
  concrete: 0x8a8f93,
  concreteDark: 0x5f666b,
  steel: 0x59636a,
  rust: 0x9a5a35,
  olive: 0x5c6b50,
  hazard: 0xd8a336,
};

/**
 * @param {THREE.Scene} scene
 * @param {{ next(): number, range(a:number,b:number): number, pick<T>(a:T[]): T }} rng
 * @returns {{ colliders: THREE.Box3[], group: THREE.Group, spawn: {x:number,z:number}, bounds: {minX:number,maxX:number,minZ:number,maxZ:number} }}
 */
export function createWorld(scene, rng) {
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);

  // Small local aliases so the layout reads like a level, not like math.
  const rand = (a, b) => rng.range(a, b);
  const chance = (p) => rng.next() < p;

  // ------------------------------------------------------------------ sky/fog
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 22, 84);

  // ------------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0xa8c4dd, 0x3a3226, 0.62);
  hemi.position.set(0, 24, 0);
  group.add(hemi);

  // Key light: warm, low-ish sun, the only shadow caster (cheap, readable).
  const key = new THREE.DirectionalLight(0xffe6c0, 1.35);
  key.position.set(19, 27, 13);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 90;
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 26;
  key.shadow.camera.bottom = -26;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  group.add(key);

  // Fill: cold, no shadows, opposite side so the shaded faces keep their shape.
  const fill = new THREE.DirectionalLight(0x7fb4ff, 0.45);
  fill.position.set(-17, 15, -19);
  group.add(fill);

  // ---------------------------------------------------------------- materials
  const mats = {
    sand: new THREE.MeshStandardMaterial({ color: PALETTE.sand, roughness: 0.97, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ color: PALETTE.concreteDark, roughness: 0.92, metalness: 0.05 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.olive, roughness: 0.85, metalness: 0.06 }),
    crateAlt: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.88, metalness: 0.05 }),
    pillar: new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9, metalness: 0.04 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.62, metalness: 0.35 }),
    ramp: new THREE.MeshStandardMaterial({
      color: PALETTE.hazard,
      roughness: 0.8,
      metalness: 0.15,
      side: THREE.DoubleSide, // wedge winding is not worth the hand-verified normals
    }),
  };

  /** Footprints already claimed, used to keep props from interpenetrating. */
  const claimed = [];
  const claim = (x, z, hx, hz) => claimed.push({ x, z, hx, hz });
  function fits(x, z, hx, hz, gap = 1.1) {
    // Keep the floor clear in the middle of the south edge (player spawns there).
    if (Math.abs(x) < ARENA.spawnClear + hx && z > ARENA.half - 5.5) return false;
    if (Math.abs(x) < 2.2 && Math.abs(z) < 2.2) return false; // arena centre stays open
    for (let i = 0; i < claimed.length; i++) {
      const c = claimed[i];
      if (Math.abs(x - c.x) < hx + c.hx + gap && Math.abs(z - c.z) < hz + c.hz + gap) return false;
    }
    return true;
  }

  /** Register a world-space AABB (plus optional extra tags) from centre + size. */
  function pushCollider(cx, cy, cz, sx, sy, sz, extra) {
    const box = new THREE.Box3(
      new THREE.Vector3(cx - sx / 2, cy, cz - sz / 2),
      new THREE.Vector3(cx + sx / 2, cy + sy, cz + sz / 2),
    );
    if (extra) Object.assign(box, extra);
    colliders.push(box);
    return box;
  }

  // -------------------------------------------------------------------- floor
  const floorGeo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, 1, 1);
  const floor = new THREE.Mesh(floorGeo, mats.sand);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // A thin slab under the floor so the arena reads as a solid pad from outside.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(ARENA.size + 2, 1.2, ARENA.size + 2), mats.wall);
  slab.position.y = -0.62;
  group.add(slab);

  // -------------------------------------------------------------- outer walls
  // Four walls, inward faces exactly on the 40x40 boundary.
  const wallDefs = [
    { x: 0, z: -ARENA.half - ARENA.wallThickness / 2, sx: ARENA.size + ARENA.wallThickness * 2, sz: ARENA.wallThickness },
    { x: 0, z: ARENA.half + ARENA.wallThickness / 2, sx: ARENA.size + ARENA.wallThickness * 2, sz: ARENA.wallThickness },
    { x: -ARENA.half - ARENA.wallThickness / 2, z: 0, sx: ARENA.wallThickness, sz: ARENA.size },
    { x: ARENA.half + ARENA.wallThickness / 2, z: 0, sx: ARENA.wallThickness, sz: ARENA.size },
  ];
  for (const w of wallDefs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.sx, ARENA.wallHeight, w.sz), mats.wall);
    mesh.position.set(w.x, ARENA.wallHeight / 2, w.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pushCollider(w.x, 0, w.z, w.sx, ARENA.wallHeight, w.sz);
  }

  // ------------------------------------------------------------------- crates
  /** Axis-aligned crate. `yaw` only tilts the mesh; the hull stays a box. */
  function addCrate(x, z, w, h, d, yaw = 0, mat = mats.crate) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, h / 2, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    // Rotated footprint -> axis-aligned hull, so the box never pokes outside it.
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    const sx = w * c + d * s;
    const sz = w * s + d * c;
    pushCollider(x, 0, z, sx, h, sz);
    claim(x, z, sx / 2, sz / 2);
    return mesh;
  }

  /** Crate stacked on top of another one - tests vertical bulk in collision. */
  function addStack(x, z, w, h, d) {
    addCrate(x, z, w, h, d, 0, mats.crateAlt);
    const upperW = w * 0.72;
    const upperH = h * 0.65;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(upperW, upperH, d * 0.8), mats.crate);
    mesh.position.set(x + rand(-0.08, 0.08), h + upperH / 2, z + rand(-0.08, 0.08));
    mesh.rotation.y = rand(-0.12, 0.12);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pushCollider(x, h, z, upperW, upperH, d * 0.8);
  }

  // Perimeter clutter: one crate per ~36 degrees, hugging the walls.
  const perimeter = 10;
  for (let i = 0; i < perimeter; i++) {
    const a = (i / perimeter) * Math.PI * 2 + rand(-0.12, 0.12);
    const r = rand(14.6, 16.8);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const w = rand(1.0, 2.1);
    const d = rand(1.0, 2.1);
    const h = chance(0.35) ? rand(0.45, 0.55) : rand(1.0, 2.3);
    if (!fits(x, z, w / 2, d / 2, 0.7)) continue;
    addCrate(x, z, w, h, d, chance(0.5) ? rand(-0.35, 0.35) : 0, chance(0.5) ? mats.crate : mats.crateAlt);
  }

  // Mid-field cover: random but rejections make it deterministic and readable.
  let placed = 0;
  for (let tries = 0; tries < 90 && placed < 9; tries++) {
    const x = rand(-13, 13);
    const z = rand(-13, 13);
    const w = rand(0.9, 2.4);
    const d = rand(0.9, 2.4);
    const h = chance(0.3) ? rand(0.42, 0.55) : rand(0.9, 2.0);
    if (!fits(x, z, w / 2, d / 2, 1.2)) continue;
    addCrate(x, z, w, h, d, chance(0.4) ? rand(-0.4, 0.4) : 0, chance(0.5) ? mats.crate : mats.crateAlt);
    placed++;
  }

  // Two deliberate stacks near opposite corners.
  addStack(-10.5, -7.5, 1.8, 1.05, 1.8);
  addStack(11.2, 8.4, 1.7, 1.0, 1.7);

  // ------------------------------------------------------------------ pillars
  /** Round pillar: cylinder mesh, square hull (circumscribed, so no corner leaks). */
  function addPillar(x, z, radius, height) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.06, height, 14, 1), mats.pillar);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pushCollider(x, 0, z, radius * 2, height, radius * 2);
    claim(x, z, radius, radius);

    // Steel collar at the base, purely so they read as structural.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.18, radius * 1.24, 0.22, 14), mats.steel);
    collar.position.set(x, 0.11, z);
    collar.receiveShadow = true;
    group.add(collar);
  }

  const pillarCount = 6;
  for (let i = 0; i < pillarCount; i++) {
    const a = (i / pillarCount) * Math.PI * 2 + 0.42;
    const r = rand(8.4, 9.6);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const radius = rand(0.52, 0.86);
    if (!fits(x, z, radius, radius, 1.4)) continue;
    addPillar(x, z, radius, rand(3.2, 4.8));
  }

  // -------------------------------------------------------------------- ramps
  /**
   * Triangular wedge you can actually walk up. The hull is the footprint AABB
   * with a `ramp` descriptor attached; the player samples that to get ground
   * height instead of being blocked by the hull.
   * @param {'x'|'z'} axis  direction the ramp climbs along
   * @param {1|-1} dir      which way along that axis is "up"
   */
  function addRamp(x, z, width, length, rise, axis = 'z', dir = 1) {
    const w = width / 2;
    const l = length / 2;

    // Wedge in local space: long axis = local Z, low edge at -l, high edge at +l.
    const verts = new Float32Array([
      // bottom
      -w, 0, -l, w, 0, -l, w, 0, l,
      -w, 0, -l, w, 0, l, -w, 0, l,
      // slope (low edge -> high edge)
      -w, 0, -l, w, rise, l, w, 0, -l,
      -w, 0, -l, -w, rise, l, w, rise, l,
      // tall back face
      -w, 0, l, w, rise, l, w, 0, l,
      -w, 0, l, -w, rise, l, w, rise, l,
      // sides
      -w, 0, -l, -w, 0, l, -w, rise, l,
      w, 0, -l, w, rise, l, w, 0, l,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mats.ramp);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, 0.02, z);
    // Local +Z is the climb direction; rotate so it points along `axis*dir`.
    mesh.rotation.y = axis === 'z' ? (dir === 1 ? 0 : Math.PI) : (dir === 1 ? -Math.PI / 2 : Math.PI / 2);
    group.add(mesh);

    // Footprint in world space (width/length swap when the ramp runs along X).
    const sx = axis === 'z' ? width : length;
    const sz = axis === 'z' ? length : width;
    const box = pushCollider(x, 0, z, sx, rise, sz);

    // Ground sampling data: height goes lowY -> highY across the climb axis.
    const lo = axis === 'z' ? z - l : x - l;
    const hi = axis === 'z' ? z + l : x + l;
    box.ramp = {
      axis,
      dir,
      min: dir === 1 ? lo : hi,
      max: dir === 1 ? hi : lo,
      lowY: 0,
      highY: rise,
    };
    claim(x, z, sx / 2, sz / 2);
    return mesh;
  }

  // Three ramps at fixed-ish spots, angles from the rng so no run is identical.
  addRamp(-8.4, 5.2, rand(2.6, 3.2), rand(4.4, 5.4), rand(1.1, 1.5), 'z', 1);
  addRamp(8.8, -6.6, rand(2.6, 3.2), rand(4.4, 5.4), rand(1.1, 1.5), 'z', -1);
  addRamp(0.6, 12.4, rand(3.0, 3.6), rand(4.0, 5.0), rand(0.9, 1.2), 'x', 1);

  // ------------------------------------------------------- low sandbag clusters
  // Small 0.45m blocks: under the step height, so bodies walk over them.
  for (let i = 0; i < 5; i++) {
    const a = rand(0, Math.PI * 2);
    const r = rand(5.5, 13.5);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const w = rand(1.6, 2.8);
    const d = rand(0.6, 1.1);
    if (!fits(x, z, w / 2, d / 2, 1.0)) continue;
    addCrate(x, z, w, 0.45, d, rand(-0.5, 0.5), mats.steel);
  }

  // Spawn: middle of the south edge, looking north into the yard.
  const spawn = { x: 0, z: ARENA.half - 4.5 };

  return {
    colliders,
    group,
    spawn,
    bounds: { minX: -ARENA.half, maxX: ARENA.half, minZ: -ARENA.half, maxZ: ARENA.half },
  };
}
