/**
 * Rocket exhaust: flame, embers and smoke, emitted from the tail only.
 *
 * Phase 5.3 of docs/plans/01-implementation-plan.md.
 *
 * Three layers, and the ORDER IS THE POINT — smoke under embers under flame
 * under the rocket sprite. Two of the layers are particles, so their order is
 * handled inside `particles.render()` (smoke has its own pass, drawn first).
 * The flame is not a particle: it is a shape welded to the nozzle every frame,
 * so the caller draws it between the particle pass and the rocket:
 *
 *     particles.render(ctx);            // smoke, then ember streaks, then points
 *     trail.drawFlame(ctx, x, y, ...);  // the teardrop at the nozzle
 *     drawRocket(ctx, x, y, ...);       // the sprite on top
 *
 * `emit()` takes primitives rather than an options object because it runs every
 * frame; an object literal here would be the one allocation the Phase 6 memory
 * profile is looking for.
 *
 * The flame's fill is a LINEAR gradient (gold-hi -> flame -> red-hi), which the
 * Phase 0 allow-list permits for exactly this kind of body fill. It is not a
 * radial gradient and there is no softening filter or glow anywhere here: the
 * embers are the same crisp points and streaks as every other spark.
 */

import { PALETTE } from '../config/palette.js';
import { KIND, colorIndexOf } from './particles.js';

/** Flame teardrop nominal size, CSS px (plan 5.3). */
const FLAME_W = 14;
const FLAME_H = 34;

/** Per-frame vertical scale jitter of the flame (plan 5.3). */
const FLAME_SCALE_MIN = 0.85;
const FLAME_SCALE_MAX = 1.15;

/**
 * Embers: plan 5.3 says "3-5 per frame". Expressed as a rate so the trail is
 * identical at 30, 60 and 120 Hz — 240/s is 4 per frame at 60 fps, the middle
 * of the stated range.
 */
const EMBER_RATE = 240;
const EMBER_SIZE_MIN = 1.2;
const EMBER_SIZE_MAX = 3.8;
const EMBER_LIFE_MIN = 0.5;
const EMBER_LIFE_MAX = 1.1;

/** Fraction of the rocket's velocity an ember inherits, reversed. */
const EMBER_BACKWASH_MIN = 0.12;
const EMBER_BACKWASH_MAX = 0.34;

/** Lateral spread given to an ember, CSS px/s. */
const EMBER_SPREAD = 46;

/** Smoke: one puff every ~40 ms with a 2.4 s life (plan 5.3). */
const SMOKE_INTERVAL = 0.04;
const SMOKE_LIFE = 2.4;
const SMOKE_DRIFT = 16;

/** Cap on how much emission a single long frame may release at once, so a
 *  stalled tab returning to life does not dump 400 embers in one step. */
const MAX_EMBERS_PER_FRAME = 12;
const MAX_PUFFS_PER_FRAME = 4;

/**
 * Create an exhaust emitter bound to a particle pool.
 *
 * @param {object} system the Phase 6.1 particle pool
 * @param {object} [options]
 * @param {number} [options.emberRate=240] embers per second
 * @param {number} [options.smokeInterval=0.04] seconds between puffs
 * @param {number} [options.smokeScale=1] multiplier on puff radius
 * @returns {{ emit: Function, drawFlame: Function, reset: Function }}
 */
export function createTrail(system, options) {
  const o = options || {};
  const emberRate = o.emberRate === undefined ? EMBER_RATE : o.emberRate;
  const smokeInterval = o.smokeInterval === undefined ? SMOKE_INTERVAL : o.smokeInterval;
  const smokeScale = o.smokeScale === undefined ? 1 : o.smokeScale;
  const rng = system.rng;

  // Ember colours resolved once. Building this array per frame would allocate.
  const emberColors = new Int32Array(3);
  emberColors[0] = colorIndexOf('goldHi');
  emberColors[1] = colorIndexOf('flame');
  emberColors[2] = colorIndexOf('redHi');
  const smokeColor = colorIndexOf('smoke');

  let emberAcc = 0;
  let smokeAcc = 0;

  // Gradient cache. A CanvasGradient is tied to the coordinates it was built
  // with, so it is rebuilt only when the flame's height actually changes — the
  // flame is drawn in local space under a translate, which is what makes that
  // possible at all.
  let gradient = null;
  let gradientH = -1;

  /**
   * Emit one frame of exhaust.
   *
   * @param {number} dt seconds
   * @param {number} x  nozzle position, CSS px (world space)
   * @param {number} y
   * @param {number} vx rocket velocity, CSS px/s
   * @param {number} vy
   * @param {number} [scale=1] set-piece scale, so a phone gets a smaller plume
   */
  function emit(dt, x, y, vx, vy, scale) {
    if (dt <= 0) return;
    const s = scale === undefined ? 1 : scale;

    // --- Embers -------------------------------------------------------------
    emberAcc += emberRate * dt;
    let n = emberAcc | 0;
    emberAcc -= n;
    if (n > MAX_EMBERS_PER_FRAME) n = MAX_EMBERS_PER_FRAME;
    for (let i = 0; i < n; i++) {
      const back = rng.range(EMBER_BACKWASH_MIN, EMBER_BACKWASH_MAX);
      system.spawn(
        KIND.EMBER,
        x + rng.range(-3, 3) * s,
        y + rng.range(-2, 6) * s,
        -vx * back + rng.jitter(EMBER_SPREAD) * s,
        -vy * back + rng.jitter(EMBER_SPREAD * 0.5) * s,
        rng.range(EMBER_LIFE_MIN, EMBER_LIFE_MAX),
        rng.range(EMBER_SIZE_MIN, EMBER_SIZE_MAX) * s,
        emberColors[(rng.next() * 3) | 0],
        0
      );
    }

    // --- Smoke --------------------------------------------------------------
    smokeAcc += dt;
    let puffs = 0;
    while (smokeAcc >= smokeInterval && puffs < MAX_PUFFS_PER_FRAME) {
      smokeAcc -= smokeInterval;
      puffs++;
      system.spawn(
        KIND.SMOKE,
        x + rng.range(-4, 4) * s,
        y + rng.range(2, 12) * s,
        rng.jitter(SMOKE_DRIFT) * s,
        // A puff keeps a trace of the rocket's motion, then stalls: heavy drag
        // in the pool bleeds this off within a few tenths of a second.
        -vy * 0.04 + rng.range(-6, 6),
        SMOKE_LIFE * rng.range(0.85, 1.15),
        smokeScale * s,
        smokeColor,
        0
      );
    }
    if (smokeAcc > smokeInterval * MAX_PUFFS_PER_FRAME) smokeAcc = 0;
  }

  /**
   * Draw the exhaust flame at the nozzle.
   *
   * A 14 x 34 px teardrop, tip trailing, filled with the plan's linear
   * gold-hi -> flame (55%) -> red-hi gradient, with its vertical scale jittered
   * 0.85-1.15 each frame so it flickers.
   *
   * Call this AFTER `particles.render()` and BEFORE the rocket sprite.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x nozzle position, CSS px
   * @param {number} y
   * @param {number} [angle=0] radians; the flame follows the rocket's tilt
   * @param {number} [scale=1]
   */
  function drawFlame(ctx, x, y, angle, scale) {
    const s = scale === undefined ? 1 : scale;
    const w = FLAME_W * s;
    const h = FLAME_H * s;
    const flicker = rng.range(FLAME_SCALE_MIN, FLAME_SCALE_MAX);
    const top = -h * 0.12;

    if (!gradient || gradientH !== h) {
      // Local coordinates: hottest at the nozzle, cooling toward the tip.
      gradient = ctx.createLinearGradient(0, top, 0, h);
      gradient.addColorStop(0, PALETTE.goldHi);
      gradient.addColorStop(0.55, PALETTE.flame);
      gradient.addColorStop(1, PALETTE.redHi);
      gradientH = h;
    }

    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.scale(1, flicker);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    // Teardrop: rounded shoulder at the nozzle, drawn out to a point below.
    ctx.moveTo(0, h);
    ctx.bezierCurveTo(w * 0.55, h * 0.55, w * 0.5, 0, 0, top);
    ctx.bezierCurveTo(-w * 0.5, 0, -w * 0.55, h * 0.55, 0, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Clear the emission accumulators. Called on replay so the first frame of a
   *  new flight does not dump a backlog of embers. */
  function reset() {
    emberAcc = 0;
    smokeAcc = 0;
    gradient = null;
    gradientH = -1;
  }

  return { emit, drawFlame, reset };
}

/** Constants the scene and harness need to agree on. */
export const TRAIL_CONSTANTS = Object.freeze({
  FLAME_W,
  FLAME_H,
  EMBER_RATE,
  SMOKE_INTERVAL,
  SMOKE_LIFE,
});
