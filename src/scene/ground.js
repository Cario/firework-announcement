/**
 * The meadow: distant hills, a conifer treeline on the horizon, the graded
 * ground band, and grass blades that fill the WHOLE band with near-to-far
 * scale.
 *
 * Painting order matters and mirrors the approved storyboard's DOM order:
 *
 *   hills -> treeline -> ground band -> blades
 *
 * Hills and trees have their bases one percent of the view height BELOW the
 * horizon, so the ground band paints over their feet and they read as rooted
 * on the skyline while rising up into the sky. Blades paint last so the near
 * grass overlaps the tree bases.
 *
 * All geometry is generated once from a fixed seed and cached in world space,
 * so the frame is identical on every load and on every replay, and a draw is
 * just a run of `fill()` calls with no trigonometry per frame.
 */

import { PALETTE } from '../config/palette.js';
import { createRng, SEEDS } from '../engine/rng.js';

/**
 * Four distant hills, verbatim from the storyboard's scenery table:
 * `[left as a fraction of the view width, width px, height px, opacity]`
 * at the reference viewport. Opacities land inside the plan's 0.55-0.75.
 */
const HILLS = [
  { left: -0.06, width: 64, height: 34, alpha: 0.55 },
  { left: 0.16, width: 90, height: 46, alpha: 0.7 },
  { left: 0.52, width: 110, height: 40, alpha: 0.6 },
  { left: 0.8, width: 86, height: 52, alpha: 0.75 },
];

/** Treeline, plan 3.2: ~64 conifers, 22-62 px tall, half-width 0.3 x height. */
const TREE_COUNT_REF = 64;
const TREE_MIN_H = 22;
const TREE_MAX_H = 62;
const TREE_WIDTH_RATIO = 0.3;

/**
 * Grass. Plan 3.2 called for ~520 blades in two greens; that read as a thin
 * scatter of spikes on a flat field. The count is up and each blade now takes
 * its colour from a seven-step ramp, which is what turns the band into a
 * meadow. Blades are batched by (colour, alpha) at build time so the draw is
 * a few dozen `fill()` calls rather than one per blade.
 */
const BLADE_COUNT_REF = 820;
const BLADE_MIN_H = 4;
const BLADE_DEPTH_H = 19;
const BLADE_MIN_W = 1.1;
const BLADE_DEPTH_W = 1.7;
const BLADE_LEAN_DEG = 17;

/**
 * Blade greens, darkest (horizon) to lightest (underfoot). A blade's index is
 * its depth across this ramp plus up to a step of jitter either way, so the
 * shading follows the ground's own recession without banding into stripes.
 */
const BLADE_SHADES = [
  PALETTE.bladeDeep,
  PALETTE.bladeShade,
  PALETTE.bladeLo,
  PALETTE.bladeMid,
  PALETTE.blade,
  PALETTE.bladeHi,
  PALETTE.bladeTip,
];

/** Roughly one blade in thirty is the odd yellower one. */
const BLADE_ACCENT = PALETTE.bladeOlive;
const BLADE_ACCENT_CHANCE = 0.965;
/** Blade tips taper rather than ending square — a rounded 2 px CSS cap at
 *  1-3 px wide is indistinguishable from this, and this is one path fewer. */
const BLADE_TIP_RATIO = 0.35;

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Build the ground layer.
 *
 * @param {object} metrics from `createWorldMetrics`
 * @param {{ seed?: number|string }} [options]
 * @returns {{
 *   update: (dt: number) => void,
 *   draw: (ctx: CanvasRenderingContext2D, camera: object) => void,
 *   resize: (metrics: object) => void,
 *   horizonY: number,
 *   counts: { trees: number, blades: number },
 * }}
 */
export function createGround(metrics, options = {}) {
  let m = metrics;

  let hills = [];
  let trees = [];
  let blades = [];
  let bladeBatches = [];
  let sceneryTopY = 0;
  let gradient = null;
  let gradientCtx = null;

  function buildHills() {
    // Hills keep their aspect ratio, so they scale by the smaller of the two
    // axes — a hill stretched to a narrow arch on a phone reads as a tower,
    // not a hill.
    const k = m.uniformScale;
    hills = HILLS.map((h) => {
      const w = h.width * k;
      const height = h.height * k;
      return {
        cx: h.left * m.viewWidth + w / 2,
        rx: w / 2,
        ry: height / 2,
        // `border-radius: 50% 50% 0 0` on a w x h box: the top half is a
        // half-ellipse, the bottom half a plain rectangle.
        flatTopY: m.baseLineY - height / 2,
        baseY: m.baseLineY,
        alpha: h.alpha,
      };
    });
  }

  function buildTrees(rng) {
    // Heights scale with the view HEIGHT so a conifer occupies the same
    // fraction of the frame as in the storyboard (the tallest is 11% of the
    // frame there, and 11% here). The count then scales with width over that
    // same factor, which holds the horizontal coverage — and therefore the
    // visual density of the treeline — constant instead of cramming 64 trees
    // into a phone's width.
    // The floor of 30 is what keeps the ridge continuous: below it, random
    // placement leaves bare stretches of horizon on a phone.
    const count = clamp(
      Math.round((TREE_COUNT_REF * m.density) / m.scale),
      30,
      110
    );

    trees = new Array(count);
    let tallest = 0;

    for (let i = 0; i < count; i++) {
      const h = rng.range(TREE_MIN_H, TREE_MAX_H) * m.scale;
      const halfW = h * TREE_WIDTH_RATIO;
      if (h > tallest) tallest = h;
      trees[i] = {
        x: rng.range(0, m.viewWidth),
        h,
        halfW,
        colour: rng.bool() ? PALETTE.tree : PALETTE.tree2,
        alpha: rng.range(0.7, 1),
      };
    }

    // Painter's order: shortest first, so the tall ones read as nearer.
    trees.sort((a, b) => a.h - b.h);
    return tallest;
  }

  function buildBlades(rng) {
    // Scaled by width, with a floor so a phone's shorter, narrower band still
    // reads as turf rather than as a few spikes on a green field.
    const count = clamp(Math.round(BLADE_COUNT_REF * m.density), 640, 1400);
    blades = new Array(count);

    for (let i = 0; i < count; i++) {
      // Plan 3.2's depth formula, exactly. d = 0 is the horizon (short, faint,
      // thin); d = 1 is the bottom of the frame (tall, saturated, wide).
      const d = rng.next();
      // Two blades at the same depth are not the same blade: an independent
      // roll on height and width is what stops the near grass looking combed.
      const vigour = 0.5 + rng.next() * 0.78;
      const h = (BLADE_MIN_H + d * BLADE_DEPTH_H) * vigour * m.scale;
      const w = (BLADE_MIN_W + d * BLADE_DEPTH_W) * (0.75 + rng.next() * 0.6) * m.scale;
      const lean = (rng.next() * 2 - 1) * BLADE_LEAN_DEG * (Math.PI / 180);

      const x = rng.range(0, m.viewWidth);
      // `bottom: (1 - d) * 100%` of the band: d = 0 sits on the horizon.
      const baseY = m.horizonY + d * m.groundHeight;

      // Pre-rotate the four corners about the blade's base centre so the draw
      // loop is pure moveTo/lineTo — no per-blade transform, no trig.
      const sin = Math.sin(lean);
      const cos = Math.cos(lean);
      const halfW = w / 2;
      const tipHalf = halfW * BLADE_TIP_RATIO;

      // Colour by depth, jittered by up to a step either way. The 0.86 keeps
      // the very lightest tip green rare, so the front of the field lifts
      // without turning into a lawn.
      const roll = rng.next();
      const raw = Math.round(d * (BLADE_SHADES.length - 1) * 0.86 + (roll - 0.5) * 2);
      let shadeIndex = clamp(raw, 0, BLADE_SHADES.length - 1);
      let colour = BLADE_SHADES[shadeIndex];
      if (roll > BLADE_ACCENT_CHANCE) {
        colour = BLADE_ACCENT;
        shadeIndex = BLADE_SHADES.length;
      }
      // Alpha quantised so blades of the same colour can share one batch.
      const alpha = Math.round((0.38 + d * 0.5) * 8) / 8;

      // Rotating blade-local (u, v) by `lean` in a y-down space:
      //   x' = u*cos - v*sin      y' = u*sin + v*cos
      // with v = -h at the tip (up is negative y).
      blades[i] = {
        d,
        // base left, base right, tip right, tip left
        x0: x - halfW * cos,
        y0: baseY - halfW * sin,
        x1: x + halfW * cos,
        y1: baseY + halfW * sin,
        x2: x + tipHalf * cos + h * sin,
        y2: baseY + tipHalf * sin - h * cos,
        x3: x - tipHalf * cos + h * sin,
        y3: baseY - tipHalf * sin - h * cos,
        shadeIndex,
        colour,
        alpha,
      };
    }

    // Far blades first: correct occlusion within a batch.
    blades.sort((a, b) => a.d - b.d);
    buildBladeBatches();
  }

  /**
   * Group the blades by (colour, alpha) so the draw loop can lay every blade
   * of one shade into a single path and fill it once.
   *
   * Batches are ordered by their mean depth, which preserves the painter's
   * order the sort established: colour and alpha both track depth, so a batch
   * is a depth slice in all but name.
   */
  function buildBladeBatches() {
    const byKey = new Map();
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i];
      const key = b.shadeIndex * 16 + Math.round(b.alpha * 8);
      let batch = byKey.get(key);
      if (!batch) {
        batch = { colour: b.colour, alpha: b.alpha, depthSum: 0, items: [] };
        byKey.set(key, batch);
      }
      batch.depthSum += b.d;
      batch.items.push(b);
    }
    bladeBatches = [...byKey.values()];
    for (const batch of bladeBatches) batch.meanDepth = batch.depthSum / batch.items.length;
    bladeBatches.sort((a, b) => a.meanDepth - b.meanDepth);
  }

  function build() {
    buildHills();
    const tallestTree = buildTrees(createRng(options.treeSeed ?? SEEDS.trees));
    buildBlades(createRng(options.grassSeed ?? SEEDS.grass));

    let tallestHill = 0;
    for (const h of hills) if (h.ry * 2 > tallestHill) tallestHill = h.ry * 2;

    sceneryTopY = m.baseLineY - Math.max(tallestTree, tallestHill) - 4;
    gradient = null;
  }

  function buildGradient(ctx) {
    // Plan 3.2: grass-hi -> grass-mid (45%) -> grass, horizon to frame bottom.
    const g = ctx.createLinearGradient(0, m.horizonY, 0, m.worldBottom);
    g.addColorStop(0, PALETTE.grassHi);
    g.addColorStop(0.45, PALETTE.grassMid);
    g.addColorStop(1, PALETTE.grass);
    return g;
  }

  build();

  return {
    get horizonY() {
      return m.horizonY;
    },

    get counts() {
      return { trees: trees.length, blades: blades.length };
    },

    /** The meadow is static; nothing to advance. Present for API symmetry. */
    update() {},

    /** Paint hills, treeline, ground band and grass, in that order. */
    draw(ctx, camera) {
      const top = camera.y;
      // Everything lives below `sceneryTopY`; once the climb has carried the
      // frame past it there is nothing here to draw.
      if (top + m.viewHeight < sceneryTopY) return;

      if (!gradient || gradientCtx !== ctx) {
        gradient = buildGradient(ctx);
        gradientCtx = ctx;
      }

      ctx.save();
      ctx.translate(0, -top);

      // --- Distant hills -------------------------------------------------
      // Graded from a lit crown down into the haze at their feet, so they
      // read as land rather than as flat blue cut-outs.
      for (let i = 0; i < hills.length; i++) {
        const h = hills[i];
        const shade = ctx.createLinearGradient(0, h.flatTopY - h.ry, 0, h.baseY);
        shade.addColorStop(0, PALETTE.hillHi);
        shade.addColorStop(0.55, PALETTE.hill);
        shade.addColorStop(1, PALETTE.hillLo);
        ctx.fillStyle = shade;
        ctx.globalAlpha = h.alpha;
        ctx.beginPath();
        // Half-ellipse cap, then straight down to the base line.
        ctx.ellipse(h.cx, h.flatTopY, h.rx, h.ry, 0, Math.PI, 0);
        ctx.lineTo(h.cx + h.rx, h.baseY);
        ctx.lineTo(h.cx - h.rx, h.baseY);
        ctx.closePath();
        ctx.fill();
      }

      // --- Treeline ------------------------------------------------------
      // Each conifer gets a shadowed right flank and a thin lit left edge.
      // A flat triangle reads as a paper cut-out; two overlays and it reads
      // as a tree with a side facing the sky.
      for (let i = 0; i < trees.length; i++) {
        const t = trees[i];
        const apexY = m.baseLineY - t.h;
        ctx.fillStyle = t.colour;
        ctx.globalAlpha = t.alpha;
        ctx.beginPath();
        ctx.moveTo(t.x, apexY);
        ctx.lineTo(t.x + t.halfW, m.baseLineY);
        ctx.lineTo(t.x - t.halfW, m.baseLineY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(0,0,0,0.34)';
        ctx.beginPath();
        ctx.moveTo(t.x, apexY);
        ctx.lineTo(t.x + t.halfW, m.baseLineY);
        ctx.lineTo(t.x + t.halfW * 0.16, m.baseLineY);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(150,190,215,0.07)';
        ctx.beginPath();
        ctx.moveTo(t.x, apexY);
        ctx.lineTo(t.x - t.halfW * 0.62, m.baseLineY);
        ctx.lineTo(t.x - t.halfW * 0.86, m.baseLineY);
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // --- Ground band ---------------------------------------------------
      // Covers the bottom 1% of the hills and trees, rooting them.
      ctx.fillStyle = gradient;
      ctx.fillRect(0, m.horizonY, m.viewWidth, m.groundHeight + 4);

      // --- Grass ---------------------------------------------------------
      // One path and one fill per shade, back to front.
      for (let i = 0; i < bladeBatches.length; i++) {
        const batch = bladeBatches[i];
        const items = batch.items;
        ctx.fillStyle = batch.colour;
        ctx.globalAlpha = batch.alpha;
        ctx.beginPath();
        for (let j = 0; j < items.length; j++) {
          const b = items[j];
          ctx.moveTo(b.x0, b.y0);
          ctx.lineTo(b.x1, b.y1);
          ctx.lineTo(b.x2, b.y2);
          ctx.lineTo(b.x3, b.y3);
          ctx.closePath();
        }
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    },

    /** Regenerate for a new viewport, from the same seeds. */
    resize(next) {
      m = next;
      build();
    },
  };
}
