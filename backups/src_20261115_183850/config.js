// All tuning lives here so the numbers behind gunplay and movement are auditable.

export const SEED = 0xb1a5c0de;

export const ROUND = {
  duration: 150, // seconds on the clock for one run
  quota: 12, // kills required to win
  waves: 3,
  perWave: 4,
  maxAlive: 3,
  spawnInterval: 1.6,
  interWaveDelay: 4.0,
};

export const PLAYER = {
  radius: 0.34,
  eyeStand: 1.62,
  eyeCrouch: 1.04,
  eyeLerp: 11.0,
  maxHealth: 100,
  accel: 52.0, // m/s^2 while input is held
  friction: 10.5, // 1/s, applied with no input
  maxSpeed: 5.2,
  sprintMul: 1.46,
  crouchMul: 0.5,
  adsMul: 0.62,
  regenDelay: 4.0, // seconds without damage before health regenerates
  regenRate: 12.0, // hp per second
  spawn: { x: 0, z: 20 },
  spawnYaw: Math.PI,
};

export const WEAPON = {
  name: 'VK-7 CARBINE',
  magSize: 24,
  reserveMax: 192,
  startReserve: 96,
  rpm: 620, // rounds per minute
  damage: 26,
  headMul: 3.0,
  limbMul: 0.72,
  range: 140,
  falloffStart: 26,
  falloffEnd: 90,
  falloffMin: 0.62,
  // radians of cone half-angle
  spreadBase: 0.0042, // 0.24 deg, standing still
  spreadMove: 0.062, // full sprint adds ~3.5 deg
  spreadCrouchMul: 0.52,
  spreadAdsMul: 0.34,
  bloomPerShot: 0.0072,
  bloomMax: 0.052,
  bloomDecay: 0.13,
  recoilPitch: 0.0138,
  recoilYaw: 0.0026,
  recoilRecover: 8.5,
  recoilMax: 0.085,
  reloadTime: 1.7,
  hipFov: 76,
  adsFov: 52,
};

export const ENEMY = {
  health: 100,
  radius: 0.42,
  eye: 1.6,
  speed: 2.55,
  accel: 16,
  sprintMul: 1.35,
  viewRange: 30,
  fov: Math.PI * 0.62, // ~112 deg total
  reaction: 0.55,
  memory: 3.2, // seconds of pursuit after losing sight
  engageMin: 8.5,
  engageMax: 15.0,
  damage: 5,
  burst: 3,
  burstDelay: 0.115,
  burstCooldownMin: 1.9,
  burstCooldownMax: 3.1,
  aimError: 0.062, // radians at 10m
  score: 100,
  scoreHead: 60,
};

export const COLORS = {
  sky: 0x0b1016,
  fog: 0x23303a,
  sand: 0x7d7160,
  concrete: 0x8a8f93,
  concreteDark: 0x5f666b,
  steel: 0x59636a,
  rust: 0x9a5a35,
  olive: 0x5c6b50,
  accent: 0x4dd7ff,
  hot: 0xff3b30,
  hazard: 0xd8a336,
};
