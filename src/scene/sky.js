/**
 * Night sky: the world column, its vertical gradient, and the seeded starfield.
 *
 * This module also owns the shared world layout (`createWorldMetrics`) because
 * it is the sky that defines how tall the world is — every other scene module
 * measures itself against the same object so nothing can drift out of register
 * on a resize.
 *
 * World space (matching `engine/camera.js`): y grows downward, `y = 0` is the
 * zenith and `y = worldHeight` is the very bottom of the meadow, which is also
 * the bottom edge of the viewport when the camera is at rest.
 */

import { PALETTE } from '../config/palette.js';
import { createRng, SEEDS } from '../engine/rng.js';

const TAU = Math.PI * 2;

/**
 * World height in viewport-heights. Plan 3.1: the sky extends well above the
 * opening frame so the camera has somewhere to climb during the 2.7 s flight.
 */
export const WORLD_SCREENS = 3.2;

/** Ground band as a fraction of the opening view. Plan 3.2. */
export const GROUND_RATIO = 0.29;

/**
 * How far the treeline / hill bases sit BELOW the horizon line, as a fraction
 * of the view height. The storyboard puts `.hills` and `.treeline` at
 * `bottom: 28%` while `.ground` is `height: 29%`, so the ground band overlaps
 * the bases by one percent and the trees read as rooted rather than floating.
 */
export const HORIZON_OVERLAP = 0.01;

/**
 * Reference viewport the storyboard's pixel numbers were authored against:
 * the deck's 1040 px column less its 1.5 rem padding is ~992 px, and the frame
 * is 16:9, so ~558 px tall. Scenery scales off these so every proportion in
 * the approved frame is preserved at other sizes instead of being re-tuned.
 */
export const REF_VIEW_WIDTH = 992;
export const REF_VIEW_HEIGHT = 558;

/** Viewport width at or below which the set-piece shrinks. Plan 3.5. */
export const NARROW_MAX_WIDTH = 760;

/** Set-piece scale on a narrow viewport. Plan 3.5: 56%. */
export const NARROW_SETPIECE_SCALE = 0.56;

/** Star count at the reference viewport. Plan 3.1: ~140. */
export const STAR_COUNT = 140;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Compute the shared scene layout for a viewport size.
 *
 * Pass the returned object to `createSky`, `createGround`, `createClouds` and
 * `createSetpiece`; rebuild it and hand the new one to each module's `resize`
 * whenever the canvas re-lays-out.
 *
 * @param {number} viewWidth  viewport width in CSS pixels
 * @param {number} viewHeight viewport height in CSS pixels
 * @returns {{
 *   viewWidth: number, viewHeight: number,
 *   worldHeight: number, worldBottom: number, restCameraY: number,
 *   groundHeight: number, horizonY: number, baseLineY: number,
 *   scale: number, density: number, uniformScale: number,
 *   setpieceScale: number,
 * }}
 *   `scale` is the vertical scenery scale (view height against the reference),
 *   so tree, blade and hill heights hold the same fraction of the frame at any
 *   size. `density` is the horizontal equivalent and drives counts, not sizes.
 *   `uniformScale` is the smaller of the two, for props that must keep their
 *   aspect ratio (the hills).
 */
export function createWorldMetrics(viewWidth, viewHeight) {
  const worldHeight = viewHeight * WORLD_SCREENS;
  const groundHeight = viewHeight * GROUND_RATIO;
  const scale = clamp(viewHeight / REF_VIEW_HEIGHT, 0.72, 1.7);
  const density = clamp(viewWidth / REF_VIEW_WIDTH, 0.34, 1.6);

  return {
    viewWidth,
    viewHeight,
    worldHeight,
    worldBottom: worldHeight,
    restCameraY: worldHeight - viewHeight,
    groundHeight,
    horizonY: worldHeight - groundHeight,
    baseLineY: worldHeight - viewHeight * (GROUND_RATIO - HORIZON_OVERLAP),
    scale,
    density,
    uniformScale: Math.min(scale, density),
    // Below the narrow breakpoint this is the plan's flat 0.56 and phones are
    // untouched. Above it the set-piece grows with the viewport, because
    // everything else in the scene already does: trees and grass scale with
    // `scale`, so a fixed-size firework was the one prop that shrank away as
    // the monitor got bigger. Growing it keeps the crop modest enough to leave
    // the treeline in frame.
    setpieceScale:
      viewWidth <= NARROW_MAX_WIDTH
        ? NARROW_SETPIECE_SCALE
        : clamp(viewWidth / 1100, 1, 1.9),
  };
}

/**
 * Build the sky layer.
 *
 * @param {ReturnType<typeof createWorldMetrics>} metrics
 * @param {{ seed?: number|string }} [options]
 * @returns {{
 *   update: (dt: number) => void,
 *   draw: (ctx: CanvasRenderingContext2D, camera: object) => void,
 *   resize: (metrics: object) => void,
 *   reset: () => void,
 *   starCount: number,
 * }}
 */
export function createSky(metrics, options = {}) {
  const seed = options.seed ?? SEEDS.stars;

  let m = metrics;
  let stars = [];
  let gradient = null;
  let gradientCtx = null;
  let time = 0;

  function build() {
    const rng = createRng(seed);

    // Star count follows viewport width so a wide desktop sky does not thin
    // out. 140 is the plan's figure and is also the floor: a phone's sky
    // column is short enough that fewer than that leaves visible bald patches
    // against the storyboard's density.
    const count = clamp(Math.round(STAR_COUNT * m.density), STAR_COUNT, 260);

    // DEVIATION from plan 3.1, which says "the upper 78% of the world".
    // Taken literally against a 3.2-screen world that stops the field 0.7
    // screens above the horizon, leaving the opening frame's sky empty below
    // its top third — the approved storyboard fills the sky right down to the
    // treeline. Stars therefore run from the zenith to just above the horizon.
    const lowest = m.horizonY - m.viewHeight * 0.02;

    stars = new Array(count);
    for (let i = 0; i < count; i++) {
      // Plan 3.1: period 2.6-4.2 s, opacity 0.28 -> 1.0, 1-2.4 px circles.
      const period = rng.range(2.6, 4.2);
      stars[i] = {
        x: rng.range(0, m.viewWidth),
        y: rng.range(0, lowest),
        r: rng.range(1, 2.4) / 2,
        omega: TAU / period,
        phase: rng.range(0, TAU),
      };
    }

    gradient = null;
  }

  function buildGradient(ctx) {
    // Anchored to the RESTING viewport, not the whole world: the opening frame
    // must show the full night-0 -> night-1 -> night-2 ramp exactly as the
    // storyboard does. Canvas clamps a linear gradient to its end colours
    // outside [0,1], so everything above the resting view is a flat night-0 —
    // which is the backdrop the bursts want anyway.
    const g = ctx.createLinearGradient(0, m.restCameraY, 0, m.worldBottom);
    g.addColorStop(0, PALETTE.night0);
    g.addColorStop(0.6, PALETTE.night1);
    g.addColorStop(1, PALETTE.night2);
    return g;
  }

  build();

  return {
    /** How many stars the current viewport generated. */
    get starCount() {
      return stars.length;
    },

    /** Advance the twinkle clock. */
    update(dt) {
      time += dt;
    },

    /**
     * Paint the sky and its stars. Draws in world coordinates and applies the
     * camera itself, so the caller does not need a transform around it.
     */
    draw(ctx, camera) {
      if (!gradient || gradientCtx !== ctx) {
        gradient = buildGradient(ctx);
        gradientCtx = ctx;
      }

      const top = camera.y;
      const bottom = top + m.viewHeight;

      ctx.save();
      ctx.translate(0, -top);

      // The context is opaque (`alpha: false`), so this fill is what clears
      // the previous frame. It must cover the whole viewport.
      ctx.fillStyle = gradient;
      ctx.fillRect(0, top - 2, m.viewWidth, m.viewHeight + 4);

      ctx.fillStyle = PALETTE.whiteSpark;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        if (s.y < top - 4 || s.y > bottom + 4) continue;
        // Raised cosine: the smooth in-and-out of the storyboard's `twinkle`
        // keyframes, per-star phase so no two blink together.
        ctx.globalAlpha =
          0.28 + 0.72 * (0.5 - 0.5 * Math.cos(s.omega * time + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      ctx.restore();
    },

    /** Regenerate for a new viewport. Same seed, so it stays deterministic. */
    resize(next) {
      m = next;
      build();
    },

    /** Rewind the twinkle clock. Positions never change — they are seeded. */
    reset() {
      time = 0;
    },
  };
}
