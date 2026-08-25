/**
 * Seeded PRNG so all scenery is identical on every load and replay.
 *
 * Scenery — star positions, grass blades, treeline, cloud silhouettes — is
 * generated from a fixed seed, so the opening frame is byte-for-byte the same
 * on every load and after every replay. Sparks draw from an unseeded stream so
 * no two bursts look cloned.
 */

/**
 * mulberry32 — a 32-bit PRNG with a 2^32 period. Small, fast, and good enough
 * that a starfield made from it looks random to a human eye.
 *
 * The constants are not arbitrary:
 *   0x6D2B79F5  an odd increment, so the counter `a` is a full-period Weyl
 *               sequence: it visits all 2^32 states before repeating.
 *   ^ >>> 15    an xorshift that mixes the high bits down before multiplying,
 *               because a plain counter's low bits barely change per step.
 *   1 | a       forces an odd multiplier, which keeps `Math.imul` invertible
 *               (an even multiplier would throw away low-bit entropy).
 *   61 | a      the second round's multiplier, again forced odd.
 *   >>> 14      final xorshift, then `>>> 0` reads the result as unsigned.
 *   / 4294967296  = 2^32, mapping to [0, 1).
 *
 * @param {number} seed 32-bit integer seed.
 * @returns {() => number} function returning floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * xmur3 string hash — lets a stream be seeded by a readable name
 * (`createRng('stars')`) instead of a magic number, while still being
 * perfectly deterministic.
 *
 * 0x85ebca6b / 0xc2b2ae35 are the murmur3 finalizer constants; they are chosen
 * to avalanche well (one input bit flipping changes about half the output).
 *
 * @param {string} str
 * @returns {number} 32-bit unsigned hash.
 */
export function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Coerce a number-or-string seed to a 32-bit unsigned integer. */
function toSeed(seed) {
  return typeof seed === 'string' ? hashString(seed) : seed >>> 0;
}

/**
 * Named seeds. Fixed constants, never derived from the clock — that is the
 * whole point. 0x4e494b48 is 'NIKH' in ASCII.
 */
export const SEEDS = {
  scenery: 0x4e494b48,
  stars: 'nikkah.stars',
  grass: 'nikkah.grass',
  trees: 'nikkah.trees',
  clouds: 'nikkah.clouds',
  hills: 'nikkah.hills',
  words: 'nikkah.words',
};

/**
 * Factory. Returns a stream with the raw generator plus the handful of
 * helpers the scene code actually wants, so callers never re-derive
 * `min + rand * (max - min)` by hand.
 *
 * @param {number|string} seed
 */
export function createRng(seed) {
  let source = mulberry32(toSeed(seed));

  const rng = {
    /** Float in [0, 1). */
    next: () => source(),
    /** Float in [min, max). */
    range: (min, max) => min + source() * (max - min),
    /** Integer in [min, max] inclusive. */
    int: (min, max) => min + Math.floor(source() * (max - min + 1)),
    /** Random element of `arr`. */
    pick: (arr) => arr[Math.floor(source() * arr.length)],
    /** True with probability `p` (default 0.5). */
    bool: (p = 0.5) => source() < p,
    /** -1 or +1. */
    sign: () => (source() < 0.5 ? -1 : 1),
    /** Symmetric jitter in [-amount, +amount). */
    jitter: (amount) => (source() * 2 - 1) * amount,
    /**
     * Restart the stream. Called on replay so regenerated scenery is
     * identical to the first run.
     */
    reseed(nextSeed = seed) {
      seed = nextSeed;
      source = mulberry32(toSeed(nextSeed));
      return rng;
    },
  };

  return rng;
}

/**
 * An unseeded stream, for sparks and anything else that should differ every
 * time. Same shape as `createRng`, so call sites are interchangeable — it is
 * just seeded from the clock and `Math.random` instead of a constant.
 */
export function createUnseededRng() {
  const seed = (Math.random() * 0xffffffff) ^ (performance.now() * 1000);
  return createRng(seed >>> 0);
}
