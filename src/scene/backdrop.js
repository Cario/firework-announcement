/**
 * The field of waiting fireworks behind the two you can choose.
 *
 * Every burst in the show has to come from somewhere. Without this the sky
 * filled with fireworks that had no source on the ground, and the meadow
 * looked like it held exactly two. So the count is derived from the sequence
 * itself: one rocket for every word the longest version of the announcement
 * will spell out, plus the mortars the bigger shells go up from.
 *
 * These are scenery, not controls. They are small, unlit, behind the two real
 * ones, and drawn with no fuse, ring or label so nothing here invites a tap.
 */

import { PALETTE } from '../config/palette.js';
import { createRng, SEEDS } from '../engine/rng.js';

const TAU = Math.PI * 2;

/** Body colours for the field, cycled. Deliberately a fairground jumble. */
const COLOURS = [
  { lo: '#8f2f22', mid: '#c8402f', hi: '#e4644f' },
  { lo: '#22348f', mid: '#2f57c8', hi: '#4f7be4' },
  { lo: '#116b4a', mid: '#1a9c6c', hi: '#35c48d' },
  { lo: '#8a6410', mid: '#c9941c', hi: '#e8b73f' },
  { lo: '#6d2080', mid: '#9c34b5', hi: '#c059d8' },
  { lo: '#0f5f74', mid: '#178aa6', hi: '#2bb6d6' },
];

/** Mortar tubes: the squat ones the big shells are fired from. */
const MORTAR_COLOURS = ['#4a3a24', '#3d3f52', '#4a2a2a'];

/**
 * Build the backdrop.
 *
 * @param {object} metrics from `createWorldMetrics`
 * @param {{ rocketCount?: number, mortarCount?: number, seed?: number|string }} [options]
 */
export function createBackdrop(metrics, options = {}) {
  let m = metrics;
  let items = [];

  /**
   * How many fireworks stand in the field.
   *
   * Defaults to the longest line count the sequence will ever fire, so the
   * ground plausibly accounts for every shell that goes up. Passed in by the
   * caller, which knows both languages' word counts.
   */
  const rocketCount = options.rocketCount ?? 32;
  const mortarCount = options.mortarCount ?? 6;

  function build() {
    const rng = createRng(options.seed ?? SEEDS.scenery);
    items = [];

    const groundTop = m.horizonY;
    const groundBottom = m.worldBottom;
    // The field sits in the BACK half of the meadow: near enough to read as
    // the same ground, far enough that the two choosable fireworks stay in
    // front of it and keep their prominence.
    const bandTop = groundTop + (groundBottom - groundTop) * 0.06;
    const bandBottom = groundTop + (groundBottom - groundTop) * 0.44;

    const total = rocketCount + mortarCount;
    for (let i = 0; i < total; i += 1) {
      // Even spread with jitter, so the row reads as scattered rather than
      // as a picket fence, but never leaves a bald patch.
      const slot = (i + 0.5) / total;
      const x = m.viewWidth * (slot + rng.range(-0.02, 0.02));
      const y = bandTop + rng.next() * (bandBottom - bandTop);

      // Depth: things further back are smaller and dimmer. `depth` runs 0 at
      // the horizon to 1 at the front of the band.
      const depth = (y - bandTop) / Math.max(1, bandBottom - bandTop);
      const scale = (0.28 + depth * 0.34) * m.scale;

      const isMortar = i % Math.ceil(total / mortarCount) === 0 && items.length > 0;

      items.push({
        x,
        y,
        scale,
        depth,
        alpha: 0.5 + depth * 0.4,
        mortar: isMortar,
        colour: isMortar
          ? MORTAR_COLOURS[i % MORTAR_COLOURS.length]
          : COLOURS[i % COLOURS.length],
        lean: rng.range(-0.16, 0.16),
        stick: 16 + rng.next() * 12,
        height: 30 + rng.next() * 16,
      });
    }

    // Painter's order: far ones first, so nearer ones overlap them.
    items.sort((a, b) => a.y - b.y);
  }

  /** A small unlit rocket: tube, two bands, cone, stick. No fuse, no label. */
  function drawSmallRocket(ctx, it) {
    const w = 9;
    const h = it.height;
    const half = w / 2;

    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.scale(it.scale, it.scale);
    ctx.rotate(it.lean);
    ctx.globalAlpha = it.alpha;

    // Stick into the ground, and a scuff of shadow where it enters.
    ctx.fillStyle = PALETTE.stick;
    ctx.fillRect(-1, -0.5, 2, it.stick);
    ctx.globalAlpha = it.alpha * 0.4;
    ctx.fillStyle = PALETTE.grass;
    ctx.beginPath();
    ctx.ellipse(0, it.stick, w * 0.7, w * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = it.alpha;

    // Tube.
    const g = ctx.createLinearGradient(-half, 0, half, 0);
    g.addColorStop(0, it.colour.lo);
    g.addColorStop(0.45, it.colour.mid);
    g.addColorStop(0.65, it.colour.hi);
    g.addColorStop(1, it.colour.lo);
    ctx.fillStyle = g;
    ctx.fillRect(-half, -h, w, h);

    // Bands.
    ctx.fillStyle = PALETTE.gold;
    ctx.globalAlpha = it.alpha * 0.8;
    ctx.fillRect(-half, -h + h * 0.22, w, 1.6);
    ctx.fillRect(-half, -h + h * 0.66, w, 1.6);
    ctx.globalAlpha = it.alpha;

    // Cone.
    ctx.fillStyle = it.colour.hi;
    ctx.beginPath();
    ctx.moveTo(0, -h - w * 0.85);
    ctx.lineTo(half, -h + 0.5);
    ctx.lineTo(-half, -h + 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /** A mortar: a squat tube on a plank, which is what big shells go up from. */
  function drawMortar(ctx, it) {
    const w = 13;
    const h = it.height * 0.5;
    const half = w / 2;

    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.scale(it.scale, it.scale);
    ctx.globalAlpha = it.alpha * 0.4;
    ctx.fillStyle = PALETTE.grass;
    ctx.beginPath();
    ctx.ellipse(0, 1, w * 0.85, w * 0.26, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = it.alpha;

    // Plank base.
    ctx.fillStyle = PALETTE.stick;
    ctx.fillRect(-w * 0.85, -3, w * 1.7, 3);

    // Tube.
    const g = ctx.createLinearGradient(-half, 0, half, 0);
    g.addColorStop(0, '#1b1b22');
    g.addColorStop(0.45, it.colour);
    g.addColorStop(1, '#1b1b22');
    ctx.fillStyle = g;
    ctx.fillRect(-half, -3 - h, w, h);

    // Open mouth, so it reads as a tube rather than a block.
    ctx.fillStyle = '#0d0d12';
    ctx.beginPath();
    ctx.ellipse(0, -3 - h, half, half * 0.34, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = PALETTE.gold;
    ctx.globalAlpha = it.alpha * 0.45;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.restore();
  }

  build();

  return {
    get count() {
      return items.length;
    },

    draw(ctx, camera) {
      const top = camera.y;
      if (m.horizonY > top + m.viewHeight || m.worldBottom < top) return;

      ctx.save();
      ctx.translate(0, -top);
      for (const it of items) {
        if (it.mortar) drawMortar(ctx, it);
        else drawSmallRocket(ctx, it);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    resize(next) {
      m = next;
      build();
    },
  };
}
