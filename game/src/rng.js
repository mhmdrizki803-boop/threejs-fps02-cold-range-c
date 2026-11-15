// Deterministic pseudo-random source for the whole game.
// Every gameplay roll (spawns, spread, AI timers, hit direction) goes through here.
// Mulberry32: 32-bit state, fast, good distribution, no platform variance.

export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Rewind to a known seed so a restart replays the same fight. */
  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
    return this;
  }

  /** Uniform float in [0, 1). */
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [a, b). */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [a, b] inclusive. */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length) % list.length];
  }

  chance(p) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Standard normal via Box-Muller, still driven only by next(). */
  gauss() {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Random unit vector on the XZ plane. */
  onCircle() {
    const a = this.next() * Math.PI * 2;
    return { x: Math.cos(a), z: Math.sin(a) };
  }

  /** Write a value into a Float32Array-backed vec3 with a random point on a sphere. */
  unitVector(out) {
    const z = this.range(-1, 1);
    const a = this.next() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    out.set(r * Math.cos(a), r * Math.sin(a), z);
    return out;
  }
}

export const rng = new Rng(0xb1a5c0de);
