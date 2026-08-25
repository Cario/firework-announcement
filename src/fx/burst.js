/**
 * Shell burst emitter with jittered angles and optional secondaries.
 *
 * Phase 6.2 of docs/plans/01-implementation-plan.md.
 *
 * A burst is a ring of sparks written straight into the Phase 6.1 pool. Three
 * details separate this from a naive `for (i) { angle = random() }`:
 *
 *  - Angles are DISTRIBUTED EVENLY and then jittered by +/-0.07 rad. Purely
 *    random angles clump — Poisson gaps are much larger than intuition expects
 *    — and a clumped shell reads as a spray, not a firework.
 *  - Vertical velocities are scaled 0.82x, giving a slightly oblate shell. A
 *    perfect circle looks computer-generated; real shells are wider than tall
 *    because they are already falling as they open.
 *  - `secondary` marks a quarter of the sparks as CRACKLE, so each pops a 3-5
 *    spark micro-burst at 60% of its life. That is the audible-looking crackle
 *    at the tail of a shell.
 *
 * No softening filters, no glow, no gradients: every spark this emits is drawn
 * by `particles.render()` as a crisp point plus a short streak.
 */

import { KIND, colorIndexOf } from './particles.js';

const TAU = Math.PI * 2;

/** Angular jitter applied to each evenly-spaced angle, in radians (plan 6.2). */
const ANGLE_JITTER = 0.07;

/** Vertical velocity scale — the oblate shell (plan 6.2). */
const OBLATE_Y = 0.82;

/** Share of sparks promoted to CRACKLE when `secondary` is on (plan 6.2). */
const SECONDARY_SHARE = 0.25;

/**
 * Module-level default particle system.
 *
 * Plan 6.2 fixes the public signature as `emitBurst({ x, y, count, ... })` with
 * no system argument, so the system is bound once by the orchestrator. Passing
 * `system` explicitly in the options still works and always wins, which is what
 * the test harness does.
 */
let defaultSystem = null;

/**
 * Bind the pool that `emitBurst` writes into when no `system` is supplied.
 * Call once, after `createParticles()`.
 *
 * @param {object|null} system
 */
export function setBurstSystem(system) {
  defaultSystem = system;
}

/** The currently bound default system, or null. */
export function getBurstSystem() {
  return defaultSystem;
}

/**
 * Resolve an array of colour names to pool indices, reusing `out` so a burst
 * called every frame does not allocate. Returns the number of entries written.
 */
const colorScratch = new Int32Array(16);
function resolveColors(colors) {
  if (!colors || colors.length === 0) {
    colorScratch[0] = colorIndexOf('gold');
    return 1;
  }
  const n = colors.length < colorScratch.length ? colors.length : colorScratch.length;
  for (let i = 0; i < n; i++) colorScratch[i] = colorIndexOf(colors[i]);
  return n;
}

/**
 * Emit one shell burst.
 *
 * @param {object} opts
 * @param {number} opts.x            burst centre, CSS px
 * @param {number} opts.y
 * @param {number} [opts.count=90]   spark count
 * @param {string[]} [opts.colors]   palette key names, cycled across the ring
 * @param {number} [opts.speedMin=90]  initial speed range, CSS px/s
 * @param {number} [opts.speedMax=260]
 * @param {number} [opts.size=2.2]   spark radius in CSS px
 * @param {number} [opts.spread=TAU] angular width of the ring; TAU is a full
 *                                   shell, smaller values make a fan
 * @param {number} [opts.angle]      centre of the fan when `spread < TAU`
 *                                   (default straight up)
 * @param {number} [opts.life=1.15]  base life in seconds; each spark varies
 *                                   +/-25% so the shell does not die at once
 * @param {boolean} [opts.secondary=false] enable the crackle micro-bursts
 * @param {object} [opts.system]     pool override; defaults to setBurstSystem()
 * @returns {number} how many sparks were actually spawned (the pool can be full)
 */
export function emitBurst(opts) {
  const system = (opts && opts.system) || defaultSystem;
  if (!system || !opts) return 0;

  const x = opts.x || 0;
  const y = opts.y || 0;
  const count = opts.count === undefined ? 90 : opts.count | 0;
  const speedMin = opts.speedMin === undefined ? 90 : opts.speedMin;
  const speedMax = opts.speedMax === undefined ? 260 : opts.speedMax;
  const size = opts.size === undefined ? 2.2 : opts.size;
  const spread = opts.spread === undefined ? TAU : opts.spread;
  const centre = opts.angle === undefined ? -Math.PI / 2 : opts.angle;
  const baseLife = opts.life === undefined ? 1.15 : opts.life;
  const secondary = opts.secondary === true;
  const rng = system.rng;

  const nColors = resolveColors(opts.colors);

  // A full ring wraps, so the last spark must not land on top of the first;
  // a fan does not wrap, so its endpoints should both be used.
  const full = spread >= TAU - 1e-6;
  const step = count > 1 ? (full ? spread / count : spread / (count - 1)) : 0;
  const start = full ? centre : centre - spread / 2;

  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const a = start + step * i + (rng.next() * 2 - 1) * ANGLE_JITTER;
    const speed = speedMin + rng.next() * (speedMax - speedMin);

    // Sparks near the rim of a shell are the fast ones; the interior of a real
    // burst is not empty, so a fraction start slower and stay near the centre.
    const radial = rng.next() < 0.22 ? speed * rng.range(0.25, 0.6) : speed;

    const vx = Math.cos(a) * radial;
    const vy = Math.sin(a) * radial * OBLATE_Y;

    const kind =
      secondary && rng.next() < SECONDARY_SHARE ? KIND.CRACKLE : KIND.SPARK;

    const idx = system.spawn(
      kind,
      x,
      y,
      vx,
      vy,
      baseLife * rng.range(0.75, 1.25),
      size * rng.range(0.75, 1.3),
      colorScratch[i % nColors],
      0
    );
    if (idx >= 0) spawned++;
  }
  return spawned;
}

/**
 * A small rising shell: the visible cause of a word's burst (plan 7.1 wants
 * every burst to have one). Emits a short trail of sparks climbing from `y`
 * with almost no lateral spread.
 *
 * @param {object} opts
 * @param {number} opts.x
 * @param {number} opts.y
 * @param {number} [opts.vy=-320] climb speed, CSS px/s (negative is up)
 * @param {number} [opts.count=6]
 * @param {string} [opts.color='gold']
 * @param {number} [opts.size=1.9]
 * @param {number} [opts.life=0.35]
 * @param {object} [opts.system]
 * @returns {number} sparks spawned
 */
export function emitShell(opts) {
  const system = (opts && opts.system) || defaultSystem;
  if (!system || !opts) return 0;

  const rng = system.rng;
  const count = opts.count === undefined ? 6 : opts.count | 0;
  const vy = opts.vy === undefined ? -320 : opts.vy;
  const ci = colorIndexOf(opts.color === undefined ? 'gold' : opts.color);
  const size = opts.size === undefined ? 1.9 : opts.size;
  const life = opts.life === undefined ? 0.35 : opts.life;

  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const idx = system.spawn(
      KIND.SPARK,
      opts.x + rng.range(-1.5, 1.5),
      opts.y + rng.range(-4, 4),
      rng.range(-14, 14),
      vy * rng.range(0.9, 1.05),
      life * rng.range(0.7, 1.2),
      size * rng.range(0.8, 1.2),
      ci,
      0
    );
    if (idx >= 0) spawned++;
  }
  return spawned;
}
