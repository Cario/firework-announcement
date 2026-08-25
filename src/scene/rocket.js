/**
 * The firework rocket: nose cone, striped body, fins, stick.
 *
 * The whole assembly is drawn under ONE transform, in one local coordinate
 * frame, with the joints deliberately overlapped by a pixel — the nose base
 * sits half a pixel inside the body top, and the fins' vertical edges sit a
 * pixel inside the body's sides. Positioning the pieces independently is what
 * made an earlier version look like a pile of loose parts, and that was a
 * specific correction from the user.
 *
 * Local origin is the CENTRE OF THE BODY'S BASE — the point the fins meet,
 * the stick hangs from, the fuse leaves, and the exhaust will come out of in
 * Phase 5. Up is negative y.
 *
 *              (0, -76)   nose apex
 *                 /\
 *                /  \     nose cone, 22 tall, 20 base
 *      (-10,-54)/____\(10,-54)
 *              |=====|    gold band at -44
 *              |     |    body, 20 x 54
 *              |=====|    gold band at -18
 *          /\  |     |  /\
 *      (-18,0)-+--+--+-(18,0)   fins, 16 tall, splaying 9 out
 *                 |  |
 *                 |__|    stick, 2.5 wide
 */

import { PALETTE } from '../config/palette.js';

/**
 * Rocket dimensions in local units, from plan 3.4 and the approved
 * storyboard. Multiply by the `scale` argument of `drawRocket`.
 */
export const ROCKET = {
  bodyWidth: 20,
  bodyHeight: 54,
  noseHeight: 22,
  noseWidth: 20,
  /** Gold bands: 4 px tall, at 10 px and 36 px from the body top. */
  bandHeight: 4,
  bandOffsets: [10, 36],
  bandAlpha: 0.9,
  /** Fins: 16 tall, splaying 9 out, rooted 1 px inside the body edge. */
  finHeight: 16,
  finSpread: 9,
  finInset: 1,
  stickWidth: 2.5,
  /** Stick length at rest; the launch phase lengthens it. */
  stickLength: 20,
  /** Nose apex above the local origin. */
  topY: -76,
};

/**
 * The body gradient is cached: it is built in LOCAL coordinates, and canvas
 * applies the current transform to a gradient at paint time, so one gradient
 * serves every position, scale and rotation the rocket is ever drawn at.
 */
let bodyGradient = null;
let bodyGradientCtx = null;

/**
 * Rocket colourways. The English firework keeps the original red; the Urdu one
 * is the same rocket in cobalt, so the two read as a matched pair on the
 * ground — a choice between two identical fireworks, not two different props.
 */
export const LIVERY = Object.freeze({
  red: Object.freeze({
    lo: PALETTE.redLo,
    mid: PALETTE.red,
    hi: PALETTE.redHi,
    nose: PALETTE.redHi,
  }),
  blue: Object.freeze({
    lo: PALETTE.rocketBlueLo,
    mid: PALETTE.rocketBlue,
    hi: PALETTE.rocketBlueHi,
    nose: PALETTE.rocketBlueHi,
  }),
});

/**
 * Gradients are cached per (context, livery). They are built in LOCAL
 * coordinates and canvas applies the current transform at paint time, so one
 * gradient per colourway serves every position, scale and rotation.
 */
function getBodyGradient(ctx, livery) {
  if (bodyGradient && bodyGradientCtx === ctx && bodyGradient.livery === livery) {
    return bodyGradient.gradient;
  }
  // Plan 3.4: horizontal lo -> mid (42%) -> hi (60%) -> lo, which is what
  // makes a flat rectangle read as a cylinder.
  const half = ROCKET.bodyWidth / 2;
  const g = ctx.createLinearGradient(-half, 0, half, 0);
  g.addColorStop(0, livery.lo);
  g.addColorStop(0.42, livery.mid);
  g.addColorStop(0.6, livery.hi);
  g.addColorStop(1, livery.lo);
  bodyGradient = { gradient: g, livery };
  bodyGradientCtx = ctx;
  return g;
}

/**
 * Draw the rocket.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x  world/screen x of the body-base centre
 * @param {number} y  world/screen y of the body-base centre
 * @param {number} [scale=1]
 * @param {number} [angle=0] radians, clockwise, about (x, y)
 * @param {{ stickLength?: number, livery?: object }} [options]
 */
export function drawRocket(ctx, x, y, scale = 1, angle = 0, options = {}) {
  const stickLength = options.stickLength ?? ROCKET.stickLength;
  const livery = options.livery || LIVERY.red;

  const halfBody = ROCKET.bodyWidth / 2;
  const bodyTop = -ROCKET.bodyHeight;
  const finRootX = halfBody - ROCKET.finInset;

  ctx.save();
  ctx.translate(x, y);
  if (angle !== 0) ctx.rotate(angle);
  if (scale !== 1) ctx.scale(scale, scale);

  // --- Stick ------------------------------------------------------------
  // Starts half a pixel above the base so it can never separate from it.
  ctx.fillStyle = PALETTE.stick;
  ctx.fillRect(
    -ROCKET.stickWidth / 2,
    -0.5,
    ROCKET.stickWidth,
    stickLength + 0.5
  );

  // --- Fins -------------------------------------------------------------
  // Drawn before the body so their inset roots disappear underneath it.
  ctx.fillStyle = livery.lo;
  ctx.beginPath();
  ctx.moveTo(-finRootX, -ROCKET.finHeight);
  ctx.lineTo(-finRootX, 0);
  ctx.lineTo(-finRootX - ROCKET.finSpread, 0);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(finRootX, -ROCKET.finHeight);
  ctx.lineTo(finRootX, 0);
  ctx.lineTo(finRootX + ROCKET.finSpread, 0);
  ctx.closePath();
  ctx.fill();

  // --- Body -------------------------------------------------------------
  ctx.fillStyle = getBodyGradient(ctx, livery);
  ctx.fillRect(-halfBody, bodyTop, ROCKET.bodyWidth, ROCKET.bodyHeight);

  // --- Gold bands -------------------------------------------------------
  ctx.fillStyle = PALETTE.gold;
  ctx.globalAlpha = ROCKET.bandAlpha;
  for (let i = 0; i < ROCKET.bandOffsets.length; i++) {
    ctx.fillRect(
      -halfBody,
      bodyTop + ROCKET.bandOffsets[i],
      ROCKET.bodyWidth,
      ROCKET.bandHeight
    );
  }
  ctx.globalAlpha = 1;

  // --- Nose cone --------------------------------------------------------
  // Base half a pixel inside the body top: flush, with no seam at any dpr.
  const noseBaseY = bodyTop + 0.5;
  const halfNose = ROCKET.noseWidth / 2;
  ctx.fillStyle = livery.nose;
  ctx.beginPath();
  ctx.moveTo(0, bodyTop - ROCKET.noseHeight);
  ctx.lineTo(halfNose, noseBaseY);
  ctx.lineTo(-halfNose, noseBaseY);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * Drop the cached body gradient. Only needed if the canvas context is ever
 * replaced; `drawRocket` already rebuilds on a context change.
 */
export function resetRocketCache() {
  bodyGradient = null;
  bodyGradientCtx = null;
}
