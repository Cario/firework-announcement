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

/** Fuse: cubic from the rocket base, dipping down and right to the tip. */
const FUSE = {
  x0: 19,
  y0: 158,
  c1x: 32,
  c1y: 167,
  c2x: 48,
  c2y: 166,
  x1: 62,
  y1: 152,
  width: 2.2,
};

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
  }));

  const byId = (id) => stations.find((st) => st.id === id) || stations[0];
  const chosen = () => (chosenId ? byId(chosenId) : stations[0]);

  let flashSparks = [];
  const demoOut = { a: 0, dx: 0, dy: 0 };
  const flashOut = { a: 0 };

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
  function drawMatch(ctx, ctxAlpha, boxX, boxY, flick, mirror) {
    ctx.save();
    ctx.globalAlpha = ctxAlpha;
    ctx.translate(boxToWorldX(boxX), toWorldY(boxY));
    // Reaching the right-hand fuse means holding the match the other way
    // round. Mirroring the whole assembly is exactly that, and the flame is
    // counter-rotated below so it still stands upright either way.
    if (mirror) ctx.scale(-1, 1);
    ctx.rotate(MATCH.angle);
    ctx.scale(scale, scale);

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

  /** Draw one whole station: fuse, rocket, tip, ring, ghost demo, match. */
  function drawStation(ctx, st) {
    // --- Fuse ------------------------------------------------------------
    // Drawn from the burn head to the rocket base; the burnt portion in
    // front of the head is simply not drawn.
    const progress = burnProgressOf(st);
    const last = st.fusePath.length - 1;
    const startIdx = Math.min(last, Math.floor(progress * last));
    if (startIdx < last) {
      ctx.strokeStyle = PALETTE.fuse;
      ctx.lineWidth = FUSE.width * scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.fusePath[startIdx].x, st.fusePath[startIdx].y);
      for (let i = startIdx + 1; i <= last; i++) {
        ctx.lineTo(st.fusePath[i].x, st.fusePath[i].y);
      }
      ctx.stroke();
    }

    // --- Rocket ------------------------------------------------------------
    if (st.rocketVisible) {
      const urdu = st.id === 'ur';
      drawRocket(
        ctx,
        toWorldX(ROCKET_LOCAL.x, st),
        toWorldY(ROCKET_LOCAL.y),
        scale,
        0,
        {
          stickLength: ROCKET_LOCAL.stick,
          livery: st.livery,
          // The language, printed on the tube. Nastaliq needs a larger size
          // than Jost to read as the same size, and sits high in its box.
          label: st.label.label,
          labelSize: urdu ? 13 : 9,
          labelFont: urdu ? '"Noto Nastaliq Urdu", serif' : null,
          labelRtl: urdu,
        }
      );
    }

    // --- Unlit fuse tip ----------------------------------------------------
    // Still unlit while the match is on its way over.
    if (st.state === 'idle' || st.state === 'armed' || st.state === 'striking') {
      ctx.fillStyle = PALETTE.fuse;
      ctx.beginPath();
      ctx.arc(toWorldX(TIP.x, st), toWorldY(TIP.y), TIP.r * scale, 0, TAU);
      ctx.fill();
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
   * The one match, drawn in box space.
   *
   * While the viewer is still choosing it leans toward each fuse in turn — a
   * ghost to the left on one cycle, to the right on the next — which is what
   * says "this one match can light either of them". Once a firework is chosen
   * it makes the real trip to that fuse and withdraws.
   */
  function drawTheMatch(ctx) {
    const flick = 0.5 - 0.5 * Math.cos((time / MATCH.flame.period) * TAU);
    const st = chosen();
    const committed = chosenId !== null && st.state !== 'idle' && st.state !== 'armed';

    if (!committed) {
      // Idle: alternate the demo between the two fuses.
      const cycle = Math.floor(time / DEMO_PERIOD);
      const target = cycle % 2 === 0 ? MATCH_TARGET.en : MATCH_TARGET.ur;
      const mirror = cycle % 2 !== 0;
      const u = (time % DEMO_PERIOD) / DEMO_PERIOD;

      if (stations[0].demoRunning) {
        sampleTrack(DEMO_KEYS, u, demoOut);
        if (demoOut.a > 0.01) {
          const gx = MATCH.x + (target.x - MATCH.x) * demoOut.dx;
          const gy = MATCH.y + (target.y - MATCH.y) * demoOut.dy;
          drawMatch(ctx, demoOut.a, mirrorX(gx, mirror), gy, flick, mirror);
        }
      }
      drawMatch(ctx, 1, MATCH.x, MATCH.y, flick, false);
      return;
    }

    let reach = 0;
    if (st.state === 'striking') {
      // Ease-out on the way in, so it arrives rather than slams.
      const pr = clamp01(st.strikeT / st.strikeTravel);
      reach = 1 - (1 - pr) * (1 - pr);
    } else if (st.state === 'burning' || st.state === 'burnt') {
      const q = clamp01(st.burnT / STRIKE_RETREAT);
      reach = 1 - q * q;
    }

    const target = MATCH_TARGET[st.id] || MATCH_TARGET.en;
    const mirror = st.id === 'ur';
    const mx = MATCH.x + (target.x - MATCH.x) * reach;
    const my = MATCH.y + (target.y - MATCH.y) * reach;
    drawMatch(ctx, 1, mirrorX(mx, mirror), my, flick, mirror);
  }

  /**
   * A mirrored match is drawn through `scale(-1, 1)` about its own pivot, so
   * the pivot itself has to be reflected back across the box centre for the
   * head to end up where it was aimed.
   */
  function mirrorX(bx, mirror) {
    return mirror ? SETPIECE_WIDTH - bx : bx;
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
      return { x: toWorldX(TIP.x, st), y: toWorldY(TIP.y) };
    },
    get burnHeadWorld() {
      const st = chosen();
      const pr = burnProgressOf(st);
      const idx = Math.min(
        st.fusePath.length - 1,
        Math.floor(pr * (st.fusePath.length - 1))
      );
      return st.fusePath[idx];
    },
    get rocketBaseWorld() {
      const st = chosen();
      return {
        x: toWorldX(ROCKET_LOCAL.x, st),
        y: toWorldY(ROCKET_LOCAL.y),
        scale,
        stickLength: ROCKET_LOCAL.stick,
        topY: toWorldY(ROCKET_LOCAL.y) + ROCKET.topY * scale,
      };
    },
    get matchWorld() {
      const st = chosen();
      return { x: toWorldX(MATCH.x, st), y: toWorldY(MATCH.y), angle: MATCH.angle };
    },

    /** The chosen firework's colourway, so the flying rocket matches it. */
    get chosenLivery() {
      return chosen().livery;
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
      for (const st of stations) {
        st.burnT = 0;
        st.strikeT = 0;
        st.burnDone = false;
        st.demoRunning = true;
        st.rocketVisible = true;
        st.state = 'idle';
      }
    },

    update(dt) {
      time += dt;
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
