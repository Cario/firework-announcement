/**
 * The idle interaction tableau: rocket staked in the grass, an unlit fuse
 * running from its base, a pulsing gold ring on the fuse tip, a lit match at
 * rest to the right, and a ghosted copy of that match that loops in to touch
 * the tip — teaching the interaction without a word of instruction.
 *
 * Everything is laid out in the approved storyboard's own 340 x 180 local
 * coordinate space, anchored bottom-centre 8% of the view height above the
 * bottom of the frame, and scaled to 56% on a narrow viewport. Keeping the
 * storyboard's numbers verbatim is what makes the opening frame match it.
 *
 * Non-negotiables encoded here, each of which was a correction from the user:
 *   - the fuse leaves the BASE of the rocket, curves down and right, and ends
 *     in an UNLIT grey tip;
 *   - the flame is on the MATCH HEAD and flickers — the fuse is never lit
 *     before the tap;
 *   - the pulsing ring sits ON the fuse tip.
 */

import { PALETTE } from '../config/palette.js';
import { createRng, SEEDS } from '../engine/rng.js';
import { easeInOutCubic, easeOutCubic, clamp01 } from '../engine/easing.js';
import { drawRocket, ROCKET, LIVERY } from './rocket.js';
import { getContent } from '../config/content.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * The storyboard's box describes ONE station: a rocket, its fuse, and its
 * match. The site now stands two of them side by side — red for English,
 * cobalt for Urdu — and lighting one is how the viewer picks their language.
 * Every local coordinate below is inside a single station's box; a station's
 * `offset` shifts it into place.
 */
/**
 * A station is now just a rocket, its fuse and its tip — the match moved out
 * to the middle, where a single one can reach either fuse. That is what makes
 * the box narrow enough for the rockets to be a large fraction of it, which is
 * in turn what makes the language printed on them readable.
 *
 * The right-hand station is MIRRORED, so both fuses run inward and the one
 * match sits between the two tips. Only the coordinates are flipped, never the
 * canvas transform — otherwise the label on the tube would come out backwards.
 */
export const STATION_WIDTH = 70;
export const STATION_GAP = 50;
export const SETPIECE_WIDTH = STATION_WIDTH * 2 + STATION_GAP;
export const SETPIECE_HEIGHT = 180;

/** The two fireworks, left to right. `id` is the language they choose. */
export const STATION_DEFS = Object.freeze([
  Object.freeze({ id: 'en', offset: 0, flip: false, livery: 'red' }),
  Object.freeze({
    id: 'ur',
    offset: STATION_WIDTH + STATION_GAP,
    flip: true,
    livery: 'blue',
  }),
]);

/** Bottom of the box, as a fraction of the view height above the frame edge. */
const BOTTOM_RATIO = 0.08;

/**
 * Fuse: cubic from the rocket's STICK, dipping down and right to the tip.
 *
 * The start used to sit at y158 — three units below the foot of an 18-unit
 * stick that ends at y155 — so the cord began in the grass a little way under
 * the firework and read as a separate object lying near it. It now starts on
 * the stick itself, well above the foot, and `drawTie` lashes it there.
 */
const FUSE = {
  x0: 19,
  y0: 147.5,
  c1x: 25,
  c1y: 163,
  c2x: 45,
  c2y: 164.5,
  x1: 62,
  y1: 152,
  width: 2.2,
};

/**
 * The launch platform, in box coordinates.
 *
 * A firework standing in the grass is a firework someone left there; one
 * carried to a platform is a firework about to be fired. It sits centre-front
 * of the box — the two stations flank it — with its top surface a little
 * above the line the rockets are staked on, so the chosen one visibly steps
 * UP onto it.
 */
const PAD = {
  x: SETPIECE_WIDTH / 2,
  ground: 175,
  top: 161,
  halfTop: 30,
  halfBase: 39,
  rail: 6.5,
};

/** How long the chosen firework takes to reach the pad, in seconds. */
const STAGE_SECONDS = 1.25;

/** How far the unchosen firework slides aside, in local units. */
const STAGE_EXIT = 72;

/** The binding that lashes the fuse to the stick: three turns of cord. */
const TIE_TURNS = 3;

/** Sample count for the fuse path. Plan 5.2: ~60 points. */
const FUSE_SAMPLES = 60;

/** Rocket: body-base centre, left of the set-piece centre. */
const ROCKET_LOCAL = { x: 19, y: 137, stick: 18 };

/** Unlit fuse tip: 9 px across, grey. */
const TIP = { x: 62.5, y: 151.5, r: 4 };

/** Pulsing ring on the tip: 78 px across, 3 px gold, 8% fill, 13 px halo. */
const RING = {
  x: 62,
  y: 152,
  radius: 21,
  width: 2,
  fillAlpha: 0.08,
  halo: 7,
  haloAlpha: 0.32,
  period: 1.8,
};

/**
 * The single match, at rest in the middle of the box between the two fuses.
 *
 * Coordinates here are BOX-local, not station-local: there is only one of it,
 * and it has to be able to reach either side. It pivots on the left end of its
 * stick, which is where the head and flame sit, so reaching the right-hand
 * fuse means drawing it mirrored.
 */
const MATCH = {
  x: 95,
  y: 116,
  angle: 24 * DEG,
  length: 34,
  thickness: 4.6,
  headX: 2.6,
  headR: 4.3,
  flame: {
    cx: 3.2,
    cy: -9,
    width: 7.5,
    height: 13.5,
    /** border-radius 50% / 62% top, 38% bottom — a teardrop, tip upward. */
    topRatio: 0.62,
    period: 1.1,
    tiltDeg: 3,
    stretch: 0.12,
  },
};

/** Where the match head must land to light each fuse, in box coordinates. */
const MATCH_TARGET = { en: { x: 62, y: 150 }, ur: { x: 128, y: 150 } };

/** How far above its fuse the match materialises before coming down. */
const MATCH_DROP = { dx: 26, dy: 46 };

/** Ghost-match demo, one loop every 3.6 s. Plan 3.5. */
const DEMO_PERIOD = 3.6;

/**
 * Demo keyframes, verbatim from the storyboard's `demo` animation.
 * `t` is the fraction of the loop; `dx`/`dy` shift the match pivot in local
 * units; `a` is opacity. The 0.40 -> 0.58 hold is 0.65 s at the fuse tip.
 */
const DEMO_KEYS = [
  { t: 0.0, a: 0, dx: 0, dy: 0 },
  { t: 0.12, a: 0.42, dx: 0.13, dy: 0.13 },
  { t: 0.4, a: 0.5, dx: 1, dy: 1 },
  { t: 0.58, a: 0.5, dx: 1, dy: 1 },
  { t: 0.8, a: 0, dx: 0.32, dy: 0.32 },
  { t: 1.0, a: 0, dx: 0, dy: 0 },
];

/** Opacity envelope of the 14-spark flash at the tip during the hold. */
const FLASH_KEYS = [
  { t: 0.0, a: 0 },
  { t: 0.38, a: 0 },
  { t: 0.46, a: 0.85 },
  { t: 0.62, a: 0.7 },
  { t: 0.74, a: 0 },
  { t: 1.0, a: 0 },
];

/** The flash itself: 14 sparks at the tip. Plan 3.5. */
const FLASH = { x: 62, y: 151, count: 14, rMin: 3, rMax: 11, size: 1.5 };

/** Fuse burn duration once lit, in seconds. Timeline 2.3: 0 -> 1.40. */
export const FUSE_BURN_SECONDS = 1.4;

/**
 * The real strike, on tap. The match travels to the fuse tip, the fuse
 * catches, and the match is drawn back. The ghost demo has been showing this
 * exact move on a loop, so the tap simply performs what was promised — it
 * lands on the same offsets as `DEMO_KEYS`.
 */
const STRIKE_TRAVEL = 0.42;
const STRIKE_RETREAT = 0.45;

/** Interpolate a keyframe track with CSS `ease-in-out` between stops. */
function sampleTrack(keys, u, out) {
  let i = 1;
  while (i < keys.length - 1 && u > keys[i].t) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const span = b.t - a.t;
  const k = span <= 0 ? 1 : easeInOutCubic((u - a.t) / span);
  out.a = a.a + (b.a - a.a) * k;
  if (a.dx !== undefined) {
    out.dx = a.dx + (b.dx - a.dx) * k;
    out.dy = a.dy + (b.dy - a.dy) * k;
  }
  return out;
}

/** Cubic bezier evaluation. */
function bezier(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  );
}

/**
 * Build the set-piece.
 *
 * @param {object} metrics from `createWorldMetrics`
 * @param {{ seed?: number|string, onFuseComplete?: () => void }} [options]
 * @returns {{
 *   update: (dt: number) => void,
 *   draw: (ctx: CanvasRenderingContext2D, camera: object) => void,
 *   resize: (metrics: object) => void,
 *   reset: () => void,
 *   stopIdleDemo: () => void,
 *   startFuseBurn: (seconds?: number) => void,
 *   setRocketVisible: (visible: boolean) => void,
 *   beginStaging: (done?: () => void) => void,
 *   stagingProgress: number,
 *   padWorld: { x: number, y: number, ground: number },
 *   localToWorld: (lx: number, ly: number) => { x: number, y: number },
 *   state: string,
 *   scale: number,
 *   burnProgress: number,
 *   fusePath: Array<{ x: number, y: number }>,
 *   burnHeadWorld: { x: number, y: number },
 *   fuseTipWorld: { x: number, y: number },
 *   rocketBaseWorld: { x: number, y: number, scale: number, stickLength: number },
 *   matchWorld: { x: number, y: number, angle: number },
 * }}
 */
export function createSetpiece(metrics, options = {}) {
  let m = metrics;

  let scale = 1;
  let originX = 0;
  let originY = 0;

  let flameGradient = null;
  let flameGradientCtx = null;

  /** Shared clock: both stations pulse and flicker together. */
  let time = 0;

  /**
   * Which station the viewer lit. Null until they choose. Every singular
   * getter below delegates to it, so the director never has to know that
   * there is more than one firework on the ground.
   */
  let chosenId = null;

  /** Per-station state. Everything that burns, strikes or hides lives here. */
  const stations = STATION_DEFS.map((def) => ({
    id: def.id,
    offset: def.offset,
    flip: def.flip,
    livery: LIVERY[def.livery],
    label: getContent(def.id),
    fusePath: [],
    state: 'idle',
    burnSeconds: FUSE_BURN_SECONDS,
    burnT: 0,
    strikeT: 0,
    strikeTravel: STRIKE_TRAVEL,
    burnDone: false,
    demoRunning: true,
    rocketVisible: true,
    // Staging offsets, in WORLD px, added to everything this station draws.
    // Zero until a firework is chosen and the two of them move.
    wx: 0,
    wy: 0,
    alpha: 1,
    // The mound of earth it was staked in, which fades as it leaves.
    standAlpha: 1,
  }));

  const byId = (id) => stations.find((st) => st.id === id) || stations[0];
  const chosen = () => (chosenId ? byId(chosenId) : stations[0]);

  let flashSparks = [];
  const demoOut = { a: 0, dx: 0, dy: 0 };
  const flashOut = { a: 0 };

  /** Staging: 0 both fireworks at their stakes, 1 the chosen one on the pad. */
  let stageT = 0;
  let staging = false;
  let onStaged = null;

  function layout() {
    scale = m.setpieceScale;
    // Bottom-centre anchored, exactly like the storyboard's
    // left:50%; bottom:8%; translateX(-50%) scale(s), origin bottom centre.
    originX = m.viewWidth / 2 - (SETPIECE_WIDTH / 2) * scale;
    originY =
      m.worldBottom - m.viewHeight * BOTTOM_RATIO - SETPIECE_HEIGHT * scale;
  }

  /**
   * Station-local x -> world x.
   *
   * The right-hand station is mirrored so its fuse runs inward toward the
   * shared match. Only the coordinate is flipped; the canvas transform is
   * left alone, so the label printed on that rocket stays the right way round.
   */
  function toWorldX(lx, st) {
    if (!st) return originX + lx * scale;
    const local = st.flip ? STATION_WIDTH - lx : lx;
    return originX + (st.offset + local) * scale;
  }

  /** Box-local x -> world x, for the match, which belongs to no station. */
  function boxToWorldX(bx) {
    return originX + bx * scale;
  }

  function toWorldY(ly) {
    return originY + ly * scale;
  }

  /** World x of the pad's centre, which is also the centre of the box. */
  function padWorldX() {
    return originX + PAD.x * scale;
  }

  /** World y of the pad's top surface — where a stick tip comes to rest. */
  function padWorldTopY() {
    return originY + PAD.top * scale;
  }

  /** World x of a station's rocket at its stake, before any staging offset. */
  function stationRocketX(st) {
    return toWorldX(ROCKET_LOCAL.x, st);
  }

  /**
   * Recompute both stations' staging offsets from `stageT`.
   *
   * The chosen firework travels to the pad on an eased arc, lifting a little
   * off the ground on the way — carried, not dragged. The other slides out of
   * frame and fades; it stays a real object leaving rather than one that
   * blinks out.
   */
  function applyStaging() {
    const k = easeInOutCubic(clamp01(stageT));
    for (const st of stations) {
      if (chosenId !== null && st.id === chosenId) {
        const dx = padWorldX() - stationRocketX(st);
        const dy = (PAD.top - ROCKET_LOCAL.stick - ROCKET_LOCAL.y) * scale;
        const hop = Math.sin(Math.PI * clamp01(stageT)) * 13 * scale;
        st.wx = dx * k;
        st.wy = dy * k - hop;
        st.alpha = 1;
        // The earth it was staked in belongs to the stake, not to the rocket,
        // so it goes as soon as the rocket does.
        st.standAlpha = 1 - clamp01(stageT * 2.6);
      } else {
        const away = (st.offset > 0 ? 1 : -1) * STAGE_EXIT * scale;
        st.wx = away * k;
        st.wy = 0;
        st.alpha = 1 - clamp01((stageT - 0.15) * 1.5);
        st.standAlpha = st.alpha;
      }
    }
  }

  function buildFuse(st) {
    st.fusePath = new Array(FUSE_SAMPLES);
    for (let i = 0; i < FUSE_SAMPLES; i++) {
      // Tip first: t walks from 1 (the tip) back to 0 (the rocket base), so
      // index 0 is where the flame starts and the burn simply consumes the
      // front of the array.
      const t = 1 - i / (FUSE_SAMPLES - 1);
      st.fusePath[i] = {
        x: toWorldX(bezier(FUSE.x0, FUSE.c1x, FUSE.c2x, FUSE.x1, t), st),
        y: toWorldY(bezier(FUSE.y0, FUSE.c1y, FUSE.c2y, FUSE.y1, t)),
      };
    }
  }

  function buildFlash() {
    const rng = createRng(options.seed ?? SEEDS.scenery);
    flashSparks = new Array(FLASH.count);
    for (let i = 0; i < FLASH.count; i++) {
      const angle = TAU * (i / FLASH.count) + rng.range(-0.07, 0.07);
      const r = rng.range(FLASH.rMin, FLASH.rMax);
      const len = r * 0.34;
      const cos = Math.cos(angle);
      // 0.82 vertical scaling: the same slightly oblate shell the burst code
      // uses, so a flash never reads as a perfect circle.
      const sin = Math.sin(angle) * 0.82;
      flashSparks[i] = {
        ix: cos * (r - len),
        iy: sin * (r - len),
        ox: cos * r,
        oy: sin * r,
        size: (FLASH.size * (0.6 + rng.next() * 0.8)) / 2,
        alpha: 0.6 + rng.next() * 0.4,
        colour: i % 2 === 0 ? PALETTE.goldHi : PALETTE.flame,
      };
    }
  }

  function build() {
    layout();
    for (const st of stations) buildFuse(st);
    buildFlash();
    // Offsets are in world px, so a resize has to restate them at the new
    // scale — otherwise a rotation mid-sequence leaves the rocket beside the
    // pad rather than on it.
    applyStaging();
    flameGradient = null;
  }

  function getFlameGradient(ctx) {
    if (flameGradient && flameGradientCtx === ctx) return flameGradient;
    const h = MATCH.flame.height;
    // Built in the flame's own local frame (box centred on the origin), so it
    // survives every translate/rotate/scale the flicker applies.
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, PALETTE.goldHi);
    g.addColorStop(0.55, PALETTE.flame);
    g.addColorStop(1, PALETTE.redHi);
    flameGradient = g;
    flameGradientCtx = ctx;
    return g;
  }

  /**
   * Draw one match — the real one or a ghost — at a local pivot, in world
   * space. The pivot is the left end of the stick, which is also where the
   * head and its flame live.
   */
  function drawMatch(ctx, ctxAlpha, boxX, boxY, flick, mirror, wx = 0, wy = 0) {
    ctx.save();
    ctx.globalAlpha = ctxAlpha;
    // The staging offsets come along: the fuse the match is aiming at has
    // moved to the pad, and a match that stayed put would light bare grass.
    ctx.translate(boxToWorldX(boxX) + wx, toWorldY(boxY) + wy);
    // Reaching the right-hand fuse means holding the match the other way
    // round. Mirroring the whole assembly is exactly that, and the flame is
    // counter-rotated below so it still stands upright either way.
    if (mirror) ctx.scale(-1, 1);
    ctx.rotate(MATCH.angle);
    ctx.scale(scale, scale);

    drawMatchBody(ctx, flick);

    ctx.restore();
  }

  /**
   * The match itself, in its own local frame: the caller has already applied
   * the translate, mirror, rotate and scale. Split out so the ghost demo can
   * reuse it under a completely different transform.
   */
  function drawMatchBody(ctx, flick) {
    // Stick: a capsule, which is what a 3 px radius on an 8 px bar reads as.
    ctx.strokeStyle = PALETTE.stick;
    ctx.lineWidth = MATCH.thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(MATCH.thickness / 2, 0);
    ctx.lineTo(MATCH.length - MATCH.thickness / 2, 0);
    ctx.stroke();

    // Head.
    ctx.fillStyle = PALETTE.redLo;
    ctx.beginPath();
    ctx.arc(MATCH.headX, 0, MATCH.headR, 0, TAU);
    ctx.fill();

    // Flame, on the head. Counter-rotated so it stands upright in world
    // space no matter how the match is held, then flickered.
    const f = MATCH.flame;
    const rx = f.width / 2;
    const ryTop = f.height * f.topRatio;
    const ryBot = f.height * (1 - f.topRatio);
    const cy = f.height / 2 - ryBot;

    ctx.save();
    ctx.translate(f.cx, f.cy);
    ctx.rotate(-MATCH.angle + flick * f.tiltDeg * DEG);
    ctx.scale(1, 1 + flick * f.stretch);

    ctx.fillStyle = getFlameGradient(ctx);
    ctx.beginPath();
    ctx.ellipse(0, cy, rx, ryTop, 0, Math.PI, 0);
    ctx.ellipse(0, cy, rx, ryBot, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Burn progress for one station, 0 unlit to 1 fully consumed. */
  function burnProgressOf(st) {
    // 'launched' has to count as fully burnt. Falling back to 0 here is what
    // made the whole fuse reappear on the ground the instant the rocket left:
    // the burn had finished, but the state had moved on past it.
    if (st.state === 'launched') return 1;
    return st.state === 'burning' || st.state === 'burnt'
      ? clamp01(st.burnT / st.burnSeconds)
      : 0;
  }

  /**
   * The mound of earth a firework is staked in.
   *
   * A stick that simply stops in the grass makes the whole thing look like a
   * sticker laid over the meadow. Pooled shadow, a low mound of soil, and a
   * few blades pushed aside by it are what put the firework IN the ground.
   */
  function drawStand(ctx, st) {
    const a = st.standAlpha;
    if (a <= 0.01) return;

    const x = stationRocketX(st);
    const y = toWorldY(ROCKET_LOCAL.y + ROCKET_LOCAL.stick);
    const s = scale;

    ctx.save();

    ctx.globalAlpha = 0.3 * a;
    ctx.fillStyle = PALETTE.soilShadow;
    ctx.beginPath();
    ctx.ellipse(x, y + 0.9 * s, 11 * s, 2.9 * s, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.75 * a;
    ctx.fillStyle = PALETTE.soil;
    ctx.beginPath();
    ctx.ellipse(x, y - 0.4 * s, 7.4 * s, 2.4 * s, 0, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = PALETTE.soilHi;
    ctx.beginPath();
    ctx.ellipse(x - 1.4 * s, y - 1.3 * s, 4.4 * s, 1.6 * s, 0, Math.PI, 0);
    ctx.fill();

    // Blades leaning away from the stake. `[x offset, height, drift]`.
    ctx.lineWidth = 1.15 * s;
    ctx.lineCap = 'round';
    const tufts = [
      [-8.4, -6.4, -2.6],
      [-4.6, -8.8, -1.2],
      [4.4, -8.2, 1.6],
      [8.2, -5.6, 2.8],
    ];
    for (let i = 0; i < tufts.length; i++) {
      const [ox, h, drift] = tufts[i];
      ctx.strokeStyle = i % 2 ? PALETTE.bladeHi : PALETTE.blade;
      ctx.beginPath();
      ctx.moveTo(x + ox * s, y);
      ctx.quadraticCurveTo(
        x + (ox + drift * 0.4) * s,
        y + h * 0.55 * s,
        x + (ox + drift) * s,
        y + h * s
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * The launch platform: a plank deck with a bore through the middle.
   *
   * Drawn before either station, so the chosen firework stands in front of
   * its own pad rather than behind it.
   */
  function drawPad(ctx) {
    const cx = padWorldX();
    const groundY = toWorldY(PAD.ground);
    const topY = padWorldTopY();
    const halfTop = PAD.halfTop * scale;
    const halfBase = PAD.halfBase * scale;
    const faceHeight = groundY - topY;

    ctx.save();

    // Contact shadow, soft-edged: a hard ellipse here read as a black hole
    // cut in the grass rather than as shade under a solid object.
    const pool = ctx.createRadialGradient(
      cx,
      groundY + 2 * scale,
      0,
      cx,
      groundY + 2 * scale,
      halfBase * 1.3
    );
    pool.addColorStop(0, 'rgba(3,8,4,0.62)');
    pool.addColorStop(0.6, 'rgba(3,8,4,0.34)');
    pool.addColorStop(1, 'rgba(3,8,4,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(cx, groundY + 2 * scale, halfBase * 1.3, 6 * scale, 0, 0, TAU);
    ctx.fill();

    // The front face: a splayed trapezoid, lit from the same side as the
    // rockets, then a vertical pass so the top edge catches and the foot
    // sinks into shadow.
    const face = ctx.createLinearGradient(cx - halfBase, 0, cx + halfBase, 0);
    face.addColorStop(0, PALETTE.padLo);
    face.addColorStop(0.3, PALETTE.padMid);
    face.addColorStop(0.52, PALETTE.padHi);
    face.addColorStop(0.74, PALETTE.padShadeMid);
    face.addColorStop(1, PALETTE.padLo);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.moveTo(cx - halfTop, topY);
    ctx.lineTo(cx + halfTop, topY);
    ctx.lineTo(cx + halfBase, groundY);
    ctx.lineTo(cx - halfBase, groundY);
    ctx.closePath();
    ctx.fill();

    const faceShade = ctx.createLinearGradient(0, topY, 0, groundY);
    faceShade.addColorStop(0, 'rgba(255,235,190,0.14)');
    faceShade.addColorStop(0.35, 'rgba(0,0,0,0)');
    faceShade.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = faceShade;
    ctx.beginPath();
    ctx.moveTo(cx - halfTop, topY);
    ctx.lineTo(cx + halfTop, topY);
    ctx.lineTo(cx + halfBase, groundY);
    ctx.lineTo(cx - halfBase, groundY);
    ctx.closePath();
    ctx.fill();

    // Plank seams, splaying with the face.
    ctx.strokeStyle = PALETTE.padSeam;
    ctx.lineWidth = 1 * scale;
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const u = i / 2.6;
      ctx.beginPath();
      ctx.moveTo(cx + halfTop * u, topY + 1.4 * scale);
      ctx.lineTo(cx + halfBase * u, groundY - 0.6 * scale);
      ctx.stroke();
    }

    // A gold strap across the face — the same trim the fireworks carry.
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = PALETTE.gold;
    const strapHalf = (halfBase + halfTop) * 0.49;
    ctx.fillRect(cx - strapHalf, topY + faceHeight * 0.52, strapHalf * 2, 1.4 * scale);
    ctx.globalAlpha = 1;

    // The deck, seen at a shallow angle.
    const deck = ctx.createLinearGradient(cx - halfTop, 0, cx + halfTop, 0);
    deck.addColorStop(0, PALETTE.padRimLo);
    deck.addColorStop(0.4, PALETTE.padRimMid);
    deck.addColorStop(0.58, PALETTE.padRimHi);
    deck.addColorStop(1, PALETTE.padRimLo);
    ctx.fillStyle = deck;
    ctx.beginPath();
    ctx.ellipse(cx, topY, halfTop, PAD.rail * 0.6 * scale, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.ellipse(cx, topY, halfTop, PAD.rail * 0.6 * scale, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The bore the stick drops into, with a lit lip on its near edge.
    const boreR = halfTop * 0.31;
    const boreY = topY + 0.4 * scale;
    const bore = ctx.createRadialGradient(cx, boreY, boreR * 0.15, cx, boreY, boreR);
    bore.addColorStop(0, PALETTE.padBoreCore);
    bore.addColorStop(0.72, PALETTE.padBoreMid);
    bore.addColorStop(1, PALETTE.padBoreEdge);
    ctx.fillStyle = bore;
    ctx.beginPath();
    ctx.ellipse(cx, boreY, boreR, boreR * 0.36, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = PALETTE.padBoreLip;
    ctx.lineWidth = 0.9 * scale;
    ctx.beginPath();
    ctx.ellipse(cx, boreY, boreR, boreR * 0.36, 0, Math.PI, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Grass in front of the base, so the pad sits in the meadow rather than
    // on top of it. `[x as a fraction of the base, height, drift]`.
    ctx.lineWidth = 1.2 * scale;
    ctx.lineCap = 'round';
    const fringe = [
      [-1.02, -7.5, -0.13],
      [-0.76, -5, 0.08],
      [-0.4, -8.6, -0.1],
      [0.34, -6.2, 0.11],
      [0.7, -9, 0.14],
      [1.0, -5.4, 0.16],
    ];
    for (let i = 0; i < fringe.length; i++) {
      const [u, h, drift] = fringe[i];
      const bx = cx + halfBase * u;
      const by = groundY + 4.5 * scale;
      ctx.strokeStyle = i % 2 ? PALETTE.bladeHi : PALETTE.blade;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        bx + drift * halfBase * 0.4,
        by + h * 0.55 * scale,
        bx + drift * halfBase,
        by + h * scale
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * The binding where the fuse meets the stick.
   *
   * Three turns of cord across the stick. Without it the fuse and the rocket
   * are two lines that happen to touch; with it they are one assembly.
   */
  function drawTie(ctx, st) {
    const x = stationRocketX(st) + st.wx;
    const y = toWorldY(FUSE.y0) + st.wy;

    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.strokeStyle = PALETTE.fuseTie;
    ctx.lineWidth = 1.1 * scale;
    ctx.lineCap = 'round';
    for (let i = 0; i < TIE_TURNS; i++) {
      const ty = y + (i - 1) * 1.9 * scale;
      ctx.beginPath();
      ctx.moveTo(x - 2.4 * scale, ty);
      ctx.lineTo(x + 2.4 * scale, ty + 0.6 * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Draw one whole station: fuse, rocket, tip, ring, ghost demo, match. */
  function drawStation(ctx, st) {
    // --- Fuse ------------------------------------------------------------
    // Drawn from the burn head to the rocket base; the burnt portion in
    // front of the head is simply not drawn.
    // The stake it stands in goes down before anything else, so the fuse and
    // the stick sit on top of the earth rather than under it.
    drawStand(ctx, st);

    const progress = burnProgressOf(st);
    const last = st.fusePath.length - 1;
    const startIdx = Math.min(last, Math.floor(progress * last));
    if (startIdx < last) {
      ctx.globalAlpha = st.alpha;
      ctx.strokeStyle = PALETTE.fuse;
      ctx.lineWidth = FUSE.width * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.fusePath[startIdx].x + st.wx, st.fusePath[startIdx].y + st.wy);
      for (let i = startIdx + 1; i <= last; i++) {
        ctx.lineTo(st.fusePath[i].x + st.wx, st.fusePath[i].y + st.wy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // --- Rocket ------------------------------------------------------------
    if (st.rocketVisible) {
      const urdu = st.id === 'ur';
      drawRocket(
        ctx,
        stationRocketX(st) + st.wx,
        toWorldY(ROCKET_LOCAL.y) + st.wy,
        scale,
        0,
        {
          stickLength: ROCKET_LOCAL.stick,
          livery: st.livery,
          alpha: st.alpha,
          // The language, printed on the tube. Nastaliq needs a larger size
          // than Jost to read as the same size, and sits high in its box.
          label: st.label.label,
          labelSize: urdu ? 13 : 9,
          labelFont: urdu ? '"Noto Nastaliq Urdu", serif' : null,
          labelRtl: urdu,
        }
      );
      drawTie(ctx, st);
    }

    // --- Unlit fuse tip ----------------------------------------------------
    // Still unlit while the match is on its way over.
    if (st.state === 'idle' || st.state === 'armed' || st.state === 'striking') {
      ctx.globalAlpha = st.alpha;
      ctx.fillStyle = PALETTE.fuse;
      ctx.beginPath();
      ctx.arc(
        toWorldX(TIP.x, st) + st.wx,
        toWorldY(TIP.y) + st.wy,
        TIP.r * scale,
        0,
        TAU
      );
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- Pulsing ring on the fuse tip --------------------------------------
    if (st.demoRunning) {
      const u = (time % RING.period) / RING.period;
      const cx = toWorldX(RING.x, st);
      const cy = toWorldY(RING.y);
      const r = RING.radius * scale;

      // 8% gold ground inside the ring.
      ctx.globalAlpha = RING.fillAlpha;
      ctx.fillStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();

      // The ring itself, brightening toward gold-hi at the peak.
      ctx.globalAlpha = 1;
      ctx.lineWidth = RING.width * scale;
      ctx.strokeStyle = PALETTE.gold;
      ctx.beginPath();
      ctx.arc(cx, cy, r - (RING.width / 2) * scale, 0, TAU);
      ctx.stroke();

      ctx.globalAlpha = 0.5 - 0.5 * Math.cos(u * TAU);
      ctx.strokeStyle = PALETTE.goldHi;
      ctx.stroke();

      // Expanding halo, 13 px, fading out. Crisp ring, no blur, no glow.
      const spread = RING.halo * easeOutCubic(u) * scale;
      if (spread > 0.5) {
        ctx.globalAlpha = RING.haloAlpha * (1 - u);
        ctx.strokeStyle = PALETTE.gold;
        ctx.lineWidth = spread;
        ctx.beginPath();
        ctx.arc(cx, cy, r + spread / 2, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- Ghost demo ---------------------------------------------------------
    if (st.demoRunning) {
      const u = (time % DEMO_PERIOD) / DEMO_PERIOD;

      // The flash at the tip, during the hold.
      sampleTrack(FLASH_KEYS, u, flashOut);
      if (flashOut.a > 0.01) {
        const fx = toWorldX(FLASH.x, st);
        const fy = toWorldY(FLASH.y);
        ctx.lineWidth = 1.5 * scale;
        ctx.lineCap = 'butt';
        for (let i = 0; i < flashSparks.length; i++) {
          const sp = flashSparks[i];
          ctx.globalAlpha = flashOut.a * 0.26;
          ctx.strokeStyle = sp.colour;
          ctx.beginPath();
          ctx.moveTo(fx + sp.ix * scale, fy + sp.iy * scale);
          ctx.lineTo(fx + sp.ox * scale, fy + sp.oy * scale);
          ctx.stroke();

          ctx.globalAlpha = flashOut.a * sp.alpha;
          ctx.fillStyle = sp.colour;
          ctx.beginPath();
          ctx.arc(fx + sp.ox * scale, fy + sp.oy * scale, sp.size * scale, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

    }
  }

  /**
   * The match, once a firework has been chosen.
   *
   * Nothing is drawn while the viewer is still deciding — a lit match sitting
   * beside one of the two rockets reads as a recommendation, and the earlier
   * version genuinely looked like it was telling people to pick the red one.
   * The neutral demonstration happens elsewhere, on its own ghost rocket.
   *
   * On a choice the match materialises above that rocket and comes DOWN onto
   * its fuse, so the gesture belongs to the firework actually picked.
   */
  function drawTheMatch(ctx) {
    if (chosenId === null) return;
    const st = chosen();
    if (st.state === 'idle' || st.state === 'armed' || st.state === 'launched') return;

    const flick = 0.5 - 0.5 * Math.cos((time / MATCH.flame.period) * TAU);

    let reach = 0;
    let fade = 1;
    if (st.state === 'striking') {
      const pr = clamp01(st.strikeT / st.strikeTravel);
      // Ease-out on the way down, so it arrives rather than slams.
      reach = 1 - (1 - pr) * (1 - pr);
      // Materialise over the first third of the descent.
      fade = clamp01(pr / 0.34);
    } else if (st.state === 'burning' || st.state === 'burnt') {
      const q = clamp01(st.burnT / STRIKE_RETREAT);
      reach = 1 - q * q;
      fade = 1 - q * q;
    }

    const target = MATCH_TARGET[st.id] || MATCH_TARGET.en;
    const mirror = st.id === 'ur';
    const fromX = target.x + (mirror ? MATCH_DROP.dx : -MATCH_DROP.dx);
    const fromY = target.y - MATCH_DROP.dy;
    const mx = fromX + (target.x - fromX) * reach;
    const my = fromY + (target.y - fromY) * reach;
    drawMatch(ctx, fade, mirrorX(mx), my, flick, mirror, st.wx, st.wy);
  }

  /**
   * The match is mirrored with scale(-1, 1) about its OWN pivot, which is
   * where the head sits — so the pivot already lands exactly where it was
   * aimed and needs no further adjustment. An earlier version also reflected
   * the coordinate across the box, which cancelled the aim out entirely and
   * sent the match to light the other language's firework.
   */
  function mirrorX(bx) {
    return bx;
  }

  build();

  const api = {
    get state() {
      return chosen().state;
    },
    get scale() {
      return scale;
    },
    get fusePath() {
      return chosen().fusePath;
    },
    get burnProgress() {
      return burnProgressOf(chosen());
    },
    get fuseTipWorld() {
      const st = chosen();
      return { x: toWorldX(TIP.x, st) + st.wx, y: toWorldY(TIP.y) + st.wy };
    },
    get burnHeadWorld() {
      const st = chosen();
      const pr = burnProgressOf(st);
      const idx = Math.min(
        st.fusePath.length - 1,
        Math.floor(pr * (st.fusePath.length - 1))
      );
      const p = st.fusePath[idx];
      return { x: p.x + st.wx, y: p.y + st.wy };
    },
    get rocketBaseWorld() {
      const st = chosen();
      const y = toWorldY(ROCKET_LOCAL.y) + st.wy;
      return {
        x: stationRocketX(st) + st.wx,
        y,
        scale,
        stickLength: ROCKET_LOCAL.stick,
        topY: y + ROCKET.topY * scale,
      };
    },
    get matchWorld() {
      const st = chosen();
      return {
        x: toWorldX(MATCH.x, st) + st.wx,
        y: toWorldY(MATCH.y) + st.wy,
        angle: MATCH.angle,
      };
    },

    /**
     * How far through the move to the pad we are, 0 to 1.
     *
     * The renderer reads this to push the camera in as the firework is set
     * up, so the framing follows the action instead of holding a wide shot
     * through the one moment the viewer is meant to be watching.
     */
    get stagingProgress() {
      return easeInOutCubic(clamp01(stageT));
    },

    /** World position of the platform, for the camera to aim at. */
    get padWorld() {
      return { x: padWorldX(), y: padWorldTopY(), ground: toWorldY(PAD.ground) };
    },

    /**
     * Carry the chosen firework to the pad and clear the other one away.
     *
     * `done` fires once it is standing on the platform, which is the cue for
     * the director to start — nothing should be lit until the firework is
     * where it will be fired from.
     */
    beginStaging(done) {
      stageT = 0;
      staging = true;
      onStaged = done || null;
      applyStaging();
    },

    /** The chosen firework's colourway, so the flying rocket matches it. */
    get chosenLivery() {
      return chosen().livery;
    },

    /**
     * The demonstration, drawn in SCREEN space by the renderer.
     *
     * A third, ghosted firework with its own match, up in the sky and clear
     * of both real rockets. Putting the demo beside one of the two choices
     * made it look like an instruction to pick that one; a rocket that is
     * plainly neither of them can only be read as "here is how this works".
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx screen x of the ghost rocket's base
     * @param {number} cy screen y of the ghost rocket's base
     * @param {number} gs scale
     */
    drawChooserDemo(ctx, cx, cy, gs) {
      const u = (time % DEMO_PERIOD) / DEMO_PERIOD;
      const tipX = cx + 46 * gs;
      const tipY = cy + 12 * gs;

      ctx.save();

      // The ghost rocket.
      ctx.globalAlpha = 0.28;
      drawRocket(ctx, cx, cy, gs, 0, {
        stickLength: ROCKET_LOCAL.stick,
        livery: LIVERY.ghost,
      });

      // Its fuse, curving out to a tip.
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = PALETTE.fuse;
      ctx.lineWidth = FUSE.width * gs;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, cy + 2 * gs);
      ctx.quadraticCurveTo(cx + 24 * gs, cy + 22 * gs, tipX, tipY);
      ctx.stroke();

      // The ring on that tip, pulsing like the real ones.
      ctx.globalAlpha = 0.5 - 0.22 * Math.cos((time / RING.period) * TAU);
      ctx.strokeStyle = PALETTE.goldHi;
      ctx.lineWidth = RING.width * gs;
      ctx.beginPath();
      ctx.arc(tipX, tipY, RING.radius * gs * 0.8, 0, TAU);
      ctx.stroke();

      // The ghost match, coming down onto that fuse on a loop.
      sampleTrack(DEMO_KEYS, u, demoOut);
      if (demoOut.a > 0.01) {
        const fromX = tipX + MATCH_DROP.dx * gs;
        const fromY = tipY - MATCH_DROP.dy * gs;
        const mx = fromX + (tipX - fromX) * demoOut.dx;
        const my = fromY + (tipY - fromY) * demoOut.dy;
        const flick = 0.5 - 0.5 * Math.cos((time / MATCH.flame.period) * TAU);
        ctx.globalAlpha = demoOut.a * 1.5;
        ctx.save();
        ctx.translate(mx, my);
        ctx.scale(-1, 1);
        ctx.rotate(MATCH.angle);
        ctx.scale(gs, gs);
        drawMatchBody(ctx, flick);
        ctx.restore();
      }

      // The flash where it touches.
      sampleTrack(FLASH_KEYS, u, flashOut);
      if (flashOut.a > 0.01) {
        for (let i = 0; i < flashSparks.length; i++) {
          const sp = flashSparks[i];
          ctx.globalAlpha = flashOut.a * sp.alpha;
          ctx.fillStyle = sp.colour;
          ctx.beginPath();
          ctx.arc(tipX + sp.ox * gs, tipY + sp.oy * gs, sp.size * gs, 0, TAU);
          ctx.fill();
        }
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    },

    /** The id of the station that was lit, or null while still choosing. */
    get chosenId() {
      return chosenId;
    },

    /** World-space anchors for the language labels under each rocket. */
    get stationAnchors() {
      return stations.map((st) => ({
        id: st.id,
        x: toWorldX(ROCKET_LOCAL.x, st),
        y: toWorldY(ROCKET_LOCAL.y),
        topY: toWorldY(ROCKET_LOCAL.y) + ROCKET.topY * scale,
      }));
    },

    /**
     * Which firework did that tap mean?
     *
     * Nearest station by horizontal distance, with no dead zone: an elderly
     * viewer aiming at a rocket and landing in the grass beside it still gets
     * the language they were reaching for. Only the halfway line decides.
     */
    hitTest(worldX) {
      let best = stations[0];
      let bestDx = Infinity;
      for (const st of stations) {
        const cx = toWorldX(STATION_WIDTH / 2, st);
        const dx = Math.abs(worldX - cx);
        if (dx < bestDx) {
          bestDx = dx;
          best = st;
        }
      }
      return best.id;
    },

    /** Station-local coordinates of the chosen station -> world. */
    localToWorld(lx, ly) {
      return { x: toWorldX(lx, chosen()), y: toWorldY(ly) };
    },

    /** Stop every ring pulse and ghost demo. Called on the tap. */
    stopIdleDemo() {
      for (const st of stations) {
        st.demoRunning = false;
        if (st.state === 'idle') st.state = 'armed';
      }
    },

    /**
     * Commit to one firework. The other stays on the ground, unlit, and is
     * simply left behind as the camera climbs.
     */
    choose(id) {
      chosenId = byId(id).id;
      api.stopIdleDemo();
      return chosenId;
    },

    /**
     * Light the chosen fuse at its tip. The burn walks from the tip toward the
     * rocket base over `seconds`; the consumed portion stops being drawn.
     */
    startFuseBurn(seconds = FUSE_BURN_SECONDS, strikeSeconds = STRIKE_TRAVEL) {
      const st = chosen();
      api.stopIdleDemo();
      // The match has to physically reach the fuse before it can light it, so
      // the travel comes out of the same budget the burn was given. The
      // timeline owns the travel time, because the audio cue has to land on
      // the same instant the cord catches.
      st.strikeTravel = Math.max(0.05, strikeSeconds);
      st.burnSeconds = Math.max(0.3, seconds - st.strikeTravel);
      st.burnT = 0;
      st.strikeT = 0;
      st.burnDone = false;
      st.state = 'striking';
    },

    /** Hide the chosen rocket so a later phase can draw the flying one. */
    setRocketVisible(visible) {
      const st = chosen();
      st.rocketVisible = visible;
      if (!visible) st.state = 'launched';
    },

    /** Back to the opening frame, for replay: both fireworks stand again. */
    reset() {
      time = 0;
      chosenId = null;
      stageT = 0;
      staging = false;
      onStaged = null;
      for (const st of stations) {
        st.burnT = 0;
        st.strikeT = 0;
        st.burnDone = false;
        st.demoRunning = true;
        st.rocketVisible = true;
        st.wx = 0;
        st.wy = 0;
        st.alpha = 1;
        st.standAlpha = 1;
        st.state = 'idle';
      }
    },

    update(dt) {
      time += dt;

      if (staging) {
        stageT += dt / STAGE_SECONDS;
        applyStaging();
        if (stageT >= 1) {
          stageT = 1;
          staging = false;
          const done = onStaged;
          onStaged = null;
          applyStaging();
          if (done) done();
        }
      }

      for (const st of stations) {
        if (st.state === 'striking') {
          st.strikeT += dt;
          if (st.strikeT >= st.strikeTravel) {
            st.strikeT = st.strikeTravel;
            st.state = 'burning';
            st.burnT = 0;
          }
        }
        if (st.state === 'burning') {
          st.burnT += dt;
          if (st.burnT >= st.burnSeconds) {
            st.burnT = st.burnSeconds;
            st.state = 'burnt';
            if (!st.burnDone) {
              st.burnDone = true;
              if (options.onFuseComplete) options.onFuseComplete(st.id);
            }
          }
        }
      }
    },

    draw(ctx, camera) {
      const top = camera.y;
      const boxTop = originY;
      const boxBottom = originY + SETPIECE_HEIGHT * scale;
      if (boxTop > top + m.viewHeight || boxBottom < top) return;

      ctx.save();
      ctx.translate(0, -top);
      drawPad(ctx);
      for (const st of stations) drawStation(ctx, st);
      drawTheMatch(ctx);
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    resize(next) {
      m = next;
      build();
    },
  };

  return api;
}
