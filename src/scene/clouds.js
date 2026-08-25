/**
 * Cloud banks.
 *
 * Each cloud is ONE continuous silhouette built from merged arcs — never a
 * pile of overlapping circles. This was an explicit correction from the user
 * and is the whole point of the module: a single closed path is filled
 * `cloud-mid`, its lower 48% is re-filled `cloud-lo` for the shaded underside,
 * and the top edge alone is stroked `cloud-hi` at 3 px, both operations
 * clipped to the silhouette so nothing spills outside it.
 *
 * Six banks at varying widths, opacities and depths. Depth drives both the
 * parallax factor and the z-order: the far banks render BEHIND the rocket,
 * the near ones IN FRONT. The pass-behind moment during the climb is
 * deliberate and this split is what preserves it.
 *
 * At rest every bank sits above the top of the viewport — the approved
 * opening frame has no clouds in it — and they come into view as the camera
 * climbs.
 */

import { PALETTE } from '../config/palette.js';
import { createRng, SEEDS } from '../engine/rng.js';

/**
 * Parallax factors, plan 5.4: far banks move at 0.35x the camera, near at
 * 1.15x.
 */
export const PARALLAX_FAR = 0.35;
export const PARALLAX_NEAR = 1.15;

/** Banks in front of the rocket are those at or above this depth. */
const FRONT_DEPTH = 0.5;

/**
 * Six banks. `width` is the storyboard's px width at the reference viewport;
 * `restY` is where the bank sits relative to the resting viewport, measured in
 * view-heights (all negative — above the frame); `depth` 0 is farthest.
 * Widths and opacities are the storyboard's own six values.
 */
const BANKS = [
  { left: 0.02, restY: -0.34, width: 300, alpha: 0.85, depth: 0.15 },
  { left: 0.6, restY: -0.96, width: 200, alpha: 0.7, depth: 0.08 },
  { left: 0.58, restY: -1.62, width: 320, alpha: 0.92, depth: 0.9 },
  { left: 0.02, restY: -2.2, width: 190, alpha: 0.78, depth: 0.85 },
  { left: 0.16, restY: -1.18, width: 270, alpha: 0.9, depth: 0.95 },
  { left: 0.8, restY: -0.66, width: 150, alpha: 0.6, depth: 0.06 },
];

/** Cloud height as a fraction of its width. */
const HEIGHT_RATIO = 0.42;

/** Shaded underside starts here down the box. Plan 3.3: the lower 48%. */
const SHADE_TOP = 0.52;

/** Lit top edge stroke width. Plan 3.3: 3 px. */
const LIT_EDGE_WIDTH = 3;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * SVG endpoint-parameterised arc -> canvas centre parameterisation, for the
 * circular case (rx == ry, no rotation, large-arc-flag 0, sweep-flag 1).
 *
 * The generator emits `A r r 0 0 1 nx ny` segments; `ctx.arc` needs a centre
 * and two angles, so this is the conversion from the SVG implementation notes
 * (F.6.5), specialised to rx == ry:
 *
 *   f = sign * sqrt((r^2 - d^2) / d^2),  sign = +1 when largeArc != sweep
 *   c = midpoint + (f * dy, -f * dx)
 *
 * where (dx, dy) is half the vector from the end point back to the start.
 * A step longer than 2r cannot be spanned by that radius, so — exactly as the
 * SVG spec requires — the radius is scaled up to half the chord, which turns
 * that segment into a semicircle and gives the taller bumps.
 *
 * @returns {{ cx: number, cy: number, r: number, a0: number, a1: number }}
 */
function arcFromEndpoints(x0, y0, x1, y1, radius) {
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const d2 = dx * dx + dy * dy;

  let r = radius;
  const minR = Math.sqrt(d2);
  if (r < minR) r = minR;

  const f = Math.sqrt(Math.max(0, (r * r - d2) / d2));
  const cx = f * dy + (x0 + x1) / 2;
  const cy = -f * dx + (y0 + y1) / 2;

  return {
    cx,
    cy,
    r,
    a0: Math.atan2(y0 - cy, x0 - cx),
    a1: Math.atan2(y1 - cy, x1 - cx),
  };
}

/**
 * Generate one cloud silhouette.
 *
 * Walks x from 0 to W emitting arc segments whose radius is modulated by an
 * envelope that peaks in the middle, so the bumps swell toward the centre of
 * the cloud and taper at both ends. Every arc starts where the last one
 * finished, which is what makes the result a single continuous outline rather
 * than a row of circles.
 *
 * @param {number} W cloud width in CSS pixels
 * @param {ReturnType<import('../engine/rng.js').createRng>} rng
 */
function buildSilhouette(W, rng) {
  const H = W * HEIGHT_RATIO;
  const baseY = H - 1;

  const startY = baseY - H * 0.12;
  let x = 0;
  let y = startY;
  const arcs = [];

  while (x < W - 6) {
    const t = x / W;
    // Bigger bumps in the middle. Plan 3.3, verbatim.
    const env = 0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, t + 0.06));
    const r = (0.09 + rng.next() * 0.09) * W * env + 7;
    const nx = Math.min(W, x + 2 * r * (0.78 + rng.next() * 0.3));
    const ny = baseY - (H * 0.05 + rng.next() * H * 0.16);

    arcs.push(arcFromEndpoints(x, y, nx, ny, r));

    x = nx;
    y = ny;
  }

  return { W, H, baseY, startY, endX: x, endY: y, arcs };
}

/** Trace the top edge only: the start point plus every arc. */
function traceTopEdge(ctx, shape) {
  ctx.moveTo(0, shape.startY);
  for (let i = 0; i < shape.arcs.length; i++) {
    const a = shape.arcs[i];
    // counterclockwise = false: increasing angle, which in a y-down space is
    // clockwise on screen — the SVG sweep-flag 1 the generator emits.
    ctx.arc(a.cx, a.cy, a.r, a.a0, a.a1, false);
  }
}

/** Trace the closed silhouette: down the left edge, over the top, down the
 *  right edge, and along a flat base. */
function traceClosed(ctx, shape) {
  ctx.moveTo(0, shape.baseY);
  ctx.lineTo(0, shape.startY);
  for (let i = 0; i < shape.arcs.length; i++) {
    const a = shape.arcs[i];
    ctx.arc(a.cx, a.cy, a.r, a.a0, a.a1, false);
  }
  ctx.lineTo(shape.W, shape.baseY);
  ctx.closePath();
}

/**
 * Build the cloud layer.
 *
 * @param {object} metrics from `createWorldMetrics`
 * @param {{ seed?: number|string }} [options]
 * @returns {{
 *   update: (dt: number) => void,
 *   draw: (ctx: CanvasRenderingContext2D, camera: object, layer?: 'behind'|'front') => void,
 *   resize: (metrics: object) => void,
 *   banks: Array<object>,
 * }}
 *   `draw` takes a layer: call it once with `'behind'` before the rocket and
 *   once with `'front'` after, so the rocket passes through the bank stack.
 */
export function createClouds(metrics, options = {}) {
  let m = metrics;
  let banks = [];

  function build() {
    const rng = createRng(options.seed ?? SEEDS.clouds);
    const k = clamp(m.viewWidth / 992, 0.55, 1.5);

    banks = BANKS.map((b) => {
      const width = b.width * k;
      const parallax =
        PARALLAX_FAR + b.depth * (PARALLAX_NEAR - PARALLAX_FAR);

      return {
        depth: b.depth,
        alpha: b.alpha,
        parallax,
        front: b.depth >= FRONT_DEPTH,
        x: b.left * m.viewWidth,
        // Solve `screenY = worldY - parallax * cameraY` for the world y that
        // puts the bank at `restY` view-heights above the frame while the
        // camera is at rest. Everything above the frame at rest, so the
        // opening scene is cloudless, exactly as the storyboard shows it.
        worldY: b.restY * m.viewHeight + parallax * m.restCameraY,
        shape: buildSilhouette(width, rng),
      };
    });
  }

  build();

  return {
    get banks() {
      return banks;
    },

    /** Banks do not drift in this phase; the camera supplies all motion. */
    update() {},

    draw(ctx, camera, layer = 'behind') {
      const wantFront = layer === 'front';

      for (let i = 0; i < banks.length; i++) {
        const bank = banks[i];
        if (bank.front !== wantFront) continue;

        const shape = bank.shape;
        const screenY = bank.worldY - camera.y * bank.parallax;
        if (screenY > m.viewHeight + 8 || screenY + shape.H < -8) continue;

        ctx.save();
        ctx.translate(bank.x, screenY);
        ctx.globalAlpha = bank.alpha;

        // 1. The body: one closed path, filled once.
        ctx.beginPath();
        traceClosed(ctx, shape);
        ctx.fillStyle = PALETTE.cloudMid;
        ctx.fill();

        // 2. Shaded underside and 3. lit top edge, both confined to the
        //    silhouette. The clip is what keeps this a single solid shape
        //    instead of a rectangle and a stray stroke.
        ctx.save();
        ctx.beginPath();
        traceClosed(ctx, shape);
        ctx.clip();

        ctx.fillStyle = PALETTE.cloudLo;
        ctx.fillRect(0, shape.H * SHADE_TOP, shape.W, shape.H);

        ctx.beginPath();
        traceTopEdge(ctx, shape);
        ctx.strokeStyle = PALETTE.cloudHi;
        ctx.lineWidth = LIT_EDGE_WIDTH;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();

        ctx.globalAlpha = 1;
        ctx.restore();
      }
    },

    resize(next) {
      m = next;
      build();
    },
  };
}
