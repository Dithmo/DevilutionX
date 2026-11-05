/**
 * Seeded 32-bit linear congruential generator (Borland-style constants).
 *
 * state' = (state * 22695477 + 1) mod 2^32  (computed exactly with Math.imul)
 *
 * Pure: never touches Math.random. Every bit of simulation randomness must
 * flow through an rng created here so a run is reproducible from its seed.
 * Cosmetic effects (particles, screen shake) may use Math.random elsewhere.
 */

const LCG_MULT = 22695477;
const LCG_INC = 1;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HIGH_BITS_SHIFT = 8; // drop the weak low bits when scaling to a range
const HIGH_BITS_RANGE = 16777216; // 2^24
const PERCENT = 100;

/**
 * FNV-1a 32-bit hash of a string (anything else is coerced to string).
 * @param {*} s
 * @returns {number} unsigned 32-bit hash
 */
export function hashString(s) {
  const str = String(s);
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Mix two 32-bit values into a new seed (used by fork()).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function mixSeeds(a, b) {
  let h = ((a >>> 0) + (b >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), FNV_PRIME);
  h = Math.imul(h ^ (h >>> 13), LCG_MULT) + LCG_INC;
  return h >>> 0;
}

/**
 * Create a seeded random number generator.
 * @param {number|string} [seed=1] numeric seed (strings are hashed)
 * @returns {{
 *   seed:number, state:number,
 *   next():number, float():number, rand(n:number):number,
 *   range(lo:number,hi:number):number, pick(arr:Array):*,
 *   chance(pct:number):boolean, shuffle(arr:Array):Array,
 *   fork(tag:*):object, setState(s:number):void
 * }}
 */
export function createRng(seed = 1) {
  const start = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const rng = {
    seed: start,
    state: start,

    /** Advance and return the raw 32-bit state. */
    next() {
      rng.state = (Math.imul(rng.state, LCG_MULT) + LCG_INC) >>> 0;
      return rng.state;
    },

    /** Uniform float in [0, 1). */
    float() {
      return (rng.next() >>> HIGH_BITS_SHIFT) / HIGH_BITS_RANGE;
    },

    /** Integer in [0, n). Returns 0 for n <= 0. */
    rand(n) {
      if (!(n > 0)) return 0;
      return Math.floor(rng.float() * n);
    },

    /** Integer in [lo, hi] inclusive (order-insensitive). */
    range(lo, hi) {
      if (hi < lo) { const t = lo; lo = hi; hi = t; }
      return lo + rng.rand(hi - lo + 1);
    },

    /** Random element of an array, or undefined if empty. */
    pick(arr) {
      return arr && arr.length ? arr[rng.rand(arr.length)] : undefined;
    },

    /** True with probability pct percent (fractions allowed). */
    chance(pct) {
      return rng.float() * PERCENT < pct;
    },

    /** In-place Fisher-Yates shuffle; returns the same array. */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.rand(i + 1);
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },

    /**
     * New independent rng derived from the current state and a tag.
     * Does not advance this rng, so forking the same tag at the same state
     * yields the same child (handy for per-level seeds).
     */
    fork(tag) {
      return createRng(mixSeeds(rng.state, hashString(tag)));
    },

    /** Restore a previously captured state (for save/load). */
    setState(s) {
      rng.state = s >>> 0;
    },
  };
  return rng;
}
