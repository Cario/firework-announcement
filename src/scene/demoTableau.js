/**
 * The instructional tableau: a ghost firework, its fuse, and a match coming
 * down to light it, with the word EXAMPLE across the middle.
 *
 * Self-contained on purpose. It used to be a method on the set-piece, which
 * meant it could only be drawn inside the meadow scene and inherited that
 * scene's clock, scale and layout. It now lives on the loading screen, where
 * there is no meadow and no camera, so everything it needs is local: its own
 * geometry, its own match, and time passed in by the caller.
 *
 * Everything is drawn in a LOCAL frame centred on (0, 0) and scaled by `s`,
 * so the caller places it by handing over a centre point. That is what keeps
 * it centred at any aspect ratio — there is no viewport arithmetic inside it
 * to get wrong on a tall phone or a wide monitor.
 */

import { PALETTE } from '../config/palette.js';
import { drawRocket, ROCKET, LIVERY } from './rocket.js';

const TAU = Math.PI * 2;

/** Horizontal correction so the drawn ink is centred on the given point. */
const CENTRE_NUDGE = 7;
const DEG = Math.PI / 180;

/** One loop of the match coming in, holding, and withdrawing. */
const DEMO_PERIOD = 3.6;

/** Where the rocket, its fuse tip and the match sit, in local units. */
/**
 * Top of the drawn firework, in local units: the nose apex sits at the
 * rocket's y plus the rocket's own topY. The caption is placed clear ABOVE
 * this, which is the whole point — it was previously sitting at -18, right
 * across the middle of the tube it was supposed to be labelling.
 */
const CAPTION_CLEARANCE = 16;

const LAYOUT = {
  rocketX: -30,
  rocketY: 34,
  tipX: 26,
  tipY: 46,
  ringRadius: 17,
  ringWidth: 2,
  matchDropX: 30,
  matchDropY: 46,
};

/** The match, in its own local frame; the pivot is the head end of the stick. */
const MATCH = {
  angle: 24 * DEG,
  length: 34,
  thickness: 4.6,
  headX: 2.6,
  headR: 4.3,
  flame: { cx: 3.2, cy: -9, width: 7.5, height: 13.5, topRatio: 0.62, period: 1.1 },
};

/** Opacity and travel of the ghost match across one loop. */
const TRACK = [
  { t: 0.0, a: 0, k: 0 },
  { t: 0.14, a: 0.55, k: 0.12 },
  { t: 0.42, a: 0.8, k: 1 },
  { t: 0.62, a: 0.8, k: 1 },
  { t: 0.82, a: 0, k: 0.3 },
  { t: 1.0, a: 0, k: 0 },
];

/** Sparks at the tip while the match is touching it. */
const FLASH = { count: 14, rMin: 3, rMax: 12, size: 1.6 };

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function sample(u) {
  let i = 1;
  while (i < TRACK.length - 1 && u > TRACK[i].t) i += 1;
  const a = TRACK[i - 1];
  const b = TRACK[i];
  const span = b.t - a.t;
  const k = span <= 0 ? 1 : easeInOut((u - a.t) / span);
  return { a: a.a + (b.a - a.a) * k, k: a.k + (b.k - a.k) * k };
}

/** Deterministic flash sparks, built once. */
const flashSparks = (() => {
  const out = [];
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < FLASH.count; i += 1) {
    const angle = TAU * (i / FLASH.count) + (rnd() - 0.5) * 0.14;
    const r = FLASH.rMin + rnd() * (FLASH.rMax - FLASH.rMin);
    out.push({
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.82,
      size: (FLASH.size * (0.6 + rnd() * 0.8)) / 2,
      alpha: 0.6 + rnd() * 0.4,
      colour: i % 2 === 0 ? PALETTE.goldHi : PALETTE.flame,
    });
  }
  return out;
})();

function drawMatch(ctx, x, y, alpha, flick) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // The stick trails up and away from the head, toward the hand that would be
  // holding it, rather than down across the firework it is lighting.
  ctx.rotate(-MATCH.angle);

  ctx.strokeStyle = PALETTE.stick;
  ctx.lineWidth = MATCH.thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(MATCH.thickness / 2, 0);
  ctx.lineTo(MATCH.length - MATCH.thickness / 2, 0);
  ctx.stroke();

  ctx.fillStyle = PALETTE.redLo;
  ctx.beginPath();
  ctx.arc(MATCH.headX, 0, MATCH.headR, 0, TAU);
  ctx.fill();

  // Flame, counter-rotated so it stands upright however the match is held.
  const f = MATCH.flame;
  const rx = f.width / 2;
  const ryTop = f.height * f.topRatio;
  const ryBot = f.height * (1 - f.topRatio);
  const cy = f.height / 2 - ryBot;

  ctx.save();
  ctx.translate(f.cx, f.cy);
  ctx.rotate(MATCH.angle + flick * 3 * DEG);
  ctx.scale(1, 1 + flick * 0.12);
  const g = ctx.createLinearGradient(0, -f.height / 2, 0, f.height / 2);
  g.addColorStop(0, PALETTE.goldHi);
  g.addColorStop(0.55, PALETTE.flame);
  g.addColorStop(1, PALETTE.redHi);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, cy, rx, ryTop, 0, Math.PI, 0);
  ctx.ellipse(0, cy, rx, ryBot, 0, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/**
 * Draw the tableau centred on (cx, cy).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx centre, CSS px
 * @param {number} cy centre, CSS px
 * @param {number} s  scale
 * @param {number} t  seconds, for the loop
 * @param {{ caption?: string, captionFont?: string }} [opts]
 */
export function drawDemoTableau(ctx, cx, cy, s, t, opts = {}) {
  const u = (t % DEMO_PERIOD) / DEMO_PERIOD;
  const flick = 0.5 - 0.5 * Math.cos((t / MATCH.flame.period) * TAU);
  const step = sample(u);

  ctx.save();
  // The group is nudged right by its own ink offset: the rocket sits left of
  // the origin and the ring right of it, and measuring the drawn result showed
  // the pair landing a few units off centre. Correcting it here means the
  // caller can hand over a plain centre point and trust it.
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(CENTRE_NUDGE, 0);

  // --- the ghost rocket ---------------------------------------------------
  ctx.globalAlpha = 0.5;
  drawRocket(ctx, LAYOUT.rocketX, LAYOUT.rocketY, 1, 0, {
    stickLength: 18,
    livery: LIVERY.ghost,
    grounded: true,
  });

  // --- its fuse -----------------------------------------------------------
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = PALETTE.fuse;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(LAYOUT.rocketX, LAYOUT.rocketY + 2);
  ctx.quadraticCurveTo(
    (LAYOUT.rocketX + LAYOUT.tipX) / 2,
    LAYOUT.rocketY + 18,
    LAYOUT.tipX,
    LAYOUT.tipY
  );
  ctx.stroke();

  // --- the pulsing ring on the tip ---------------------------------------
  ctx.globalAlpha = 0.55 - 0.25 * Math.cos((t / 1.8) * TAU);
  ctx.strokeStyle = PALETTE.goldHi;
  ctx.lineWidth = LAYOUT.ringWidth;
  ctx.beginPath();
  ctx.arc(LAYOUT.tipX, LAYOUT.tipY, LAYOUT.ringRadius, 0, TAU);
  ctx.stroke();

  // --- the match, coming down onto it ------------------------------------
  if (step.a > 0.01) {
    const fromX = LAYOUT.tipX + LAYOUT.matchDropX;
    const fromY = LAYOUT.tipY - LAYOUT.matchDropY;
    drawMatch(
      ctx,
      fromX + (LAYOUT.tipX - fromX) * step.k,
      fromY + (LAYOUT.tipY - fromY) * step.k,
      step.a,
      flick
    );
  }

  // --- the flash where it touches ----------------------------------------
  if (step.k > 0.85) {
    const fade = Math.min(1, (step.k - 0.85) / 0.15) * step.a;
    for (const sp of flashSparks) {
      ctx.globalAlpha = fade * sp.alpha;
      ctx.fillStyle = sp.colour;
      ctx.beginPath();
      ctx.arc(LAYOUT.tipX + sp.x, LAYOUT.tipY + sp.y, sp.size, 0, TAU);
      ctx.fill();
    }
  }

  // --- EXAMPLE ------------------------------------------------------------
  // Centred on the tableau's own origin, not on the viewport, so it stays put
  // whatever shape the screen is.
  if (opts.caption) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = PALETTE.goldHi;
    ctx.font = opts.captionFont || '500 15px Jost, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    // Tracking by hand: this is a Latin caption, and the extra air is what
    // makes a short all-caps word read as a label rather than as shouting.
    // Above the nose cone, never across it.
    const captionY = LAYOUT.rocketY + ROCKET.topY - CAPTION_CLEARANCE;
    const text = opts.caption;
    const tracking = 4;
    let total = 0;
    for (const ch of text) total += ctx.measureText(ch).width + tracking;
    total -= tracking;
    let pen = -total / 2;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      ctx.fillText(ch, pen + w / 2, captionY);
      pen += w + tracking;
    }
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Half-width and half-height of the tableau at scale 1, for layout. */
export const TABLEAU_EXTENT = {
  halfWidth: 78,
  halfHeight: 58,
  rocketTop: LAYOUT.rocketY + ROCKET.topY,
};
