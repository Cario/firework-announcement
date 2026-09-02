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
  // Widened from the storyboard's 20 so the language can be printed across
  // the body and actually read. A firework tube is a chunky object anyway.
  bodyWidth: 34,
  bodyHeight: 58,
  noseHeight: 24,
  noseWidth: 34,
  /** Gold bands: 4 px tall, at 10 px and 36 px from the body top. */
  bandHeight: 4,
  bandOffsets: [7, 46],
  bandAlpha: 0.9,
  /** Fins: 16 tall, splaying 9 out, rooted 1 px inside the body edge. */
  finHeight: 17,
  finSpread: 11,
  finInset: 1,
  stickWidth: 2.5,
  /** Stick length at rest; the launch phase lengthens it. */
  stickLength: 20,
  /** Nose apex above the local origin. */
  topY: -82,
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
  /**
   * The demonstration rocket. Deliberately neither red nor blue: it is not
   * one of the two you can pick, it is a third, illustrative one, so it must
   * not look like either choice.
   */
  ghost: Object.freeze({
    lo: PALETTE.gold,
    mid: PALETTE.goldHi,
    hi: PALETTE.whiteSpark,
    nose: PALETTE.goldHi,
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
 * @param {{ stickLength?: number, livery?: object, alpha?: number }} [options]
 */
export function drawRocket(ctx, x, y, scale = 1, angle = 0, options = {}) {
  const stickLength = options.stickLength ?? ROCKET.stickLength;
  const livery = options.livery || LIVERY.red;
  // Every alpha inside is multiplied by this, so a caller can fade the whole
  // assembly out as one object. Setting `globalAlpha` around the call cannot
  // do that: the body, bands and label each assign their own alpha and would
  // simply overwrite it.
  const fade = options.alpha === undefined ? 1 : options.alpha;
  if (fade <= 0.004) return;

  const halfBody = ROCKET.bodyWidth / 2;
  const bodyTop = -ROCKET.bodyHeight;
  const finRootX = halfBody - ROCKET.finInset;

  ctx.save();
  ctx.translate(x, y);
  if (angle !== 0) ctx.rotate(angle);
  if (scale !== 1) ctx.scale(scale, scale);

  // --- Planted on the ground ---------------------------------------------
  // A stick that simply stops in mid-air makes the whole firework look like
  // a sticker laid over the grass. A shadow pooled at its foot and a small
  // mound of earth around it are what sell the thing as standing IN the
  // meadow rather than on top of it.
  if (options.grounded) {
    const footY = stickLength;
    ctx.globalAlpha = 0.4 * fade;
    ctx.fillStyle = PALETTE.soilShadow;
    ctx.beginPath();
    ctx.ellipse(0, footY, ROCKET.bodyWidth * 0.66, ROCKET.bodyWidth * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5 * fade;
    ctx.fillStyle = PALETTE.grass;
    ctx.beginPath();
    ctx.ellipse(0, footY - 0.5, ROCKET.bodyWidth * 0.46, ROCKET.bodyWidth * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8 * fade;
    ctx.fillStyle = PALETTE.grassHi;
    ctx.beginPath();
    ctx.ellipse(0, footY - 1.4, ROCKET.bodyWidth * 0.34, ROCKET.bodyWidth * 0.1, 0, Math.PI, 0);
    ctx.fill();
  }

  ctx.globalAlpha = fade;

  // --- Stick ------------------------------------------------------------
  // Starts half a pixel above the base so it can never separate from it.
  // Shaded across its width: at 2.5 units a flat bar reads as a printed
  // line, and the same three-stop treatment the tube gets makes it a dowel.
  const stickShade = ctx.createLinearGradient(
    -ROCKET.stickWidth / 2,
    0,
    ROCKET.stickWidth / 2,
    0
  );
  stickShade.addColorStop(0, PALETTE.stickHi);
  stickShade.addColorStop(0.45, PALETTE.stick);
  stickShade.addColorStop(1, PALETTE.stickLo);
  ctx.fillStyle = stickShade;
  ctx.fillRect(
    -ROCKET.stickWidth / 2,
    -0.5,
    ROCKET.stickWidth,
    stickLength + 0.5
  );

  // --- Fins -------------------------------------------------------------
  // Drawn before the body so their inset roots disappear underneath it.
  // Graded down into near-black at the ground edge, which is what sets them
  // behind the tube instead of beside it.
  const finShade = ctx.createLinearGradient(0, -ROCKET.finHeight, 0, 0);
  finShade.addColorStop(0, livery.mid);
  finShade.addColorStop(0.55, livery.lo);
  finShade.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = finShade;
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

  // A vertical pass over the horizontal cylinder shading: a glint along the
  // shoulder and the tube falling into shadow where it meets the fins. Two
  // axes of shading is the difference between a coloured rectangle and a
  // lit object.
  const bodyShade = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + ROCKET.bodyHeight);
  bodyShade.addColorStop(0, 'rgba(255,255,255,0.10)');
  bodyShade.addColorStop(0.3, 'rgba(255,255,255,0)');
  bodyShade.addColorStop(0.78, 'rgba(0,0,0,0)');
  bodyShade.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = bodyShade;
  ctx.fillRect(-halfBody, bodyTop, ROCKET.bodyWidth, ROCKET.bodyHeight);

  // --- Gold bands -------------------------------------------------------
  // Each band takes the tube's own curvature back over it, so the gold turns
  // with the cylinder instead of lying flat across it.
  ctx.globalAlpha = ROCKET.bandAlpha * fade;
  for (let i = 0; i < ROCKET.bandOffsets.length; i++) {
    const bandY = bodyTop + ROCKET.bandOffsets[i];
    ctx.fillStyle = PALETTE.gold;
    ctx.fillRect(-halfBody, bandY, ROCKET.bodyWidth, ROCKET.bandHeight);
    const bandShade = ctx.createLinearGradient(-halfBody, 0, halfBody, 0);
    bandShade.addColorStop(0, 'rgba(0,0,0,0.45)');
    bandShade.addColorStop(0.4, 'rgba(255,255,255,0.22)');
    bandShade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = bandShade;
    ctx.fillRect(-halfBody, bandY, ROCKET.bodyWidth, ROCKET.bandHeight);
  }
  ctx.globalAlpha = fade;

  // --- Nose cone --------------------------------------------------------
  // Base half a pixel inside the body top: flush, with no seam at any dpr.
  // Shaded across, like the tube, then a hard shadow down the right facet so
  // the cone reads as a cone and not as a flat triangle sat on a cylinder.
  const noseBaseY = bodyTop + 0.5;
  const halfNose = ROCKET.noseWidth / 2;
  const noseShade = ctx.createLinearGradient(-halfNose, 0, halfNose, 0);
  noseShade.addColorStop(0, livery.lo);
  noseShade.addColorStop(0.4, livery.nose);
  noseShade.addColorStop(0.58, livery.hi);
  noseShade.addColorStop(1, livery.lo);
  ctx.fillStyle = noseShade;
  ctx.beginPath();
  ctx.moveTo(0, bodyTop - ROCKET.noseHeight);
  ctx.lineTo(halfNose, noseBaseY);
  ctx.lineTo(-halfNose, noseBaseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.moveTo(0, bodyTop - ROCKET.noseHeight);
  ctx.lineTo(halfNose, noseBaseY);
  ctx.lineTo(halfNose * 0.34, noseBaseY);
  ctx.closePath();
  ctx.fill();

  // --- Language label ---------------------------------------------------
  // Printed straight onto the tube, between the two gold bands, which is
  // where a real firework carries its name. This is how the viewer picks a
  // language, so it has to be legible rather than decorative.
  if (options.label) {
    const size = options.labelSize || 9;

    // A printed panel, not floating text: a recessed plate in the tube's own
    // dark tone with a hairline gold edge, sitting between the two bands. The
    // label then reads as part of the firework rather than as a caption that
    // happens to be on top of it.
    const plateH = size * 1.9;
    const plateW = ROCKET.bodyWidth - 4;
    const plateY = bodyTop + ROCKET.bodyHeight / 2 - plateH / 2;
    ctx.fillStyle = livery.lo;
    ctx.fillRect(-plateW / 2, plateY, plateW, plateH);
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 0.8;
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeRect(-plateW / 2, plateY, plateW, plateH);
    ctx.globalAlpha = fade;

    ctx.fillStyle = options.labelColor || PALETTE.goldHi;
    ctx.font = options.labelFont
      ? `${size}px ${options.labelFont}`
      : `500 ${size}px Jost, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = options.labelRtl ? 'rtl' : 'ltr';

    const labelY = bodyTop + ROCKET.bodyHeight / 2;
    if (options.labelRtl) {
      // Arabic script joins; it has to be drawn as one run or it falls apart.
      ctx.fillText(options.label, 0, labelY, plateW - 4);
    } else {
      // Latin is set glyph by glyph so each one can be nudged down toward the
      // tube's edges. Text laid flat across a cylinder is the single thing
      // that makes a label look typed on afterwards rather than printed on
      // the thing itself; following the curve is what fixes it.
      const text = options.label;
      const tracking = size * 0.09;
      let total = 0;
      for (const ch of text) total += ctx.measureText(ch).width + tracking;
      total -= tracking;
      const fit = Math.min(1, (plateW - 5) / total);
      let pen = (-total * fit) / 2;
      for (const ch of text) {
        const w = ctx.measureText(ch).width * fit;
        const centre = pen + w / 2;
        // Parabolic sag: flat in the middle, dropping toward both edges.
        const k = centre / (ROCKET.bodyWidth / 2);
        ctx.save();
        ctx.translate(centre, labelY + k * k * size * 0.22);
        ctx.scale(fit, fit);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        pen += w + tracking * fit;
      }
    }

    // The tube's own shading, laid back over the label, so the print darkens
    // toward the edges exactly as the surface under it does.
    const shade = ctx.createLinearGradient(-halfBody, 0, halfBody, 0);
    shade.addColorStop(0, 'rgba(0,0,0,0.55)');
    shade.addColorStop(0.42, 'rgba(0,0,0,0)');
    shade.addColorStop(0.62, 'rgba(255,255,255,0.06)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = shade;
    ctx.fillRect(-plateW / 2, plateY, plateW, plateH);
  }

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
