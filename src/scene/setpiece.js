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
import { drawRocket, ROCKET } from './rocket.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** The storyboard's set-piece box. All local coordinates are inside this. */
export const SETPIECE_WIDTH = 340;
export const SETPIECE_HEIGHT = 180;

/** Bottom of the box, as a fraction of the view height above the frame edge. */
const BOTTOM_RATIO = 0.08;

/** Fuse: cubic from the rocket base, dipping down and right to the tip. */
const FUSE = {
  x0: 92,
  y0: 158,
  c1x: 124,
  c1y: 166,
  c2x: 164,
  c2y: 164,
  x1: 198,
  y1: 150,
  width: 2.5,
};

/** Sample count for the fuse path. Plan 5.2: ~60 points. */
const FUSE_SAMPLES = 60;

/** Rocket: body-base centre, left of the set-piece centre. */
const ROCKET_LOCAL = { x: 92, y: 137, stick: 20 };

/** Unlit fuse tip: 9 px across, grey. */
const TIP = { x: 199.5, y: 149.5, r: 4.5 };

/** Pulsing ring on the tip: 78 px across, 3 px gold, 8% fill, 13 px halo. */
const RING = {
  x: 199,
  y: 150,
  radius: 39,
  width: 3,
  fillAlpha: 0.08,
  halo: 13,
  haloAlpha: 0.32,
  period: 1.8,
};

/** Match at rest, pivoting on the left end of its 66 x 8 stick. */
const MATCH = {
  x: 262,
  y: 128,
  angle: 24 * DEG,
  length: 66,
  thickness: 8,
  headX: 4.5,
  headR: 7.5,
  flame: {
    cx: 5.5,
    cy: -16,
    width: 13,
    height: 24,
    /** border-radius 50% / 62% top, 38% bottom — a teardrop, tip upward. */
    topRatio: 0.62,
    period: 1.1,
    tiltDeg: 3,
    stretch: 0.12,
  },
};

/** Ghost-match demo, one loop every 3.6 s. Plan 3.5. */
const DEMO_PERIOD = 3.6;

/**
 * Demo keyframes, verbatim from the storyboard's `demo` animation.
 * `t` is the fraction of the loop; `dx`/`dy` shift the match pivot in local
 * units; `a` is opacity. The 0.40 -> 0.58 hold is 0.65 s at the fuse tip.
 */
const DEMO_KEYS = [
  { t: 0.0, a: 0, dx: 0, dy: 0 },
  { t: 0.12, a: 0.42, dx: -8, dy: 4 },
  { t: 0.4, a: 0.5, dx: -62, dy: 26 },
  { t: 0.58, a: 0.5, dx: -62, dy: 26 },
  { t: 0.8, a: 0, dx: -20, dy: 8 },
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
const FLASH = { x: 199, y: 149, count: 14, rMin: 6, rMax: 20, size: 2.4 };

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
const STRIKE_TO = { dx: -62, dy: 26 };

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

  /** Fuse path in WORLD coordinates, index 0 = unlit tip, last = rocket base. */
  let fusePath = [];
  /** The 14-spark flash, in local units relative to FLASH.x / FLASH.y. */
  let flashSparks = [];

  let flameGradient = null;
  let flameGradientCtx = null;

  let time = 0;
  let demoRunning = true;
  let rocketVisible = true;
  let state = 'idle';
  let burnSeconds = FUSE_BURN_SECONDS;
  let burnT = 0;
  let strikeT = 0;
  let strikeTravel = STRIKE_TRAVEL;
  let burnDone = false;

  const demoOut = { a: 0, dx: 0, dy: 0 };
  const flashOut = { a: 0 };

  function layout() {
    scale = m.setpieceScale;
    // Bottom-centre anchored, exactly like the storyboard's
    // `left:50%; bottom:8%; transform:translateX(-50%) scale(s)` with
    // `transform-origin: bottom center`.
    originX = m.viewWidth / 2 - (SETPIECE_WIDTH / 2) * scale;
    originY =
      m.worldBottom - m.viewHeight * BOTTOM_RATIO - SETPIECE_HEIGHT * scale;
  }

  function toWorldX(lx) {
    return originX + lx * scale;
  }

  function toWorldY(ly) {
    return originY + ly * scale;
  }

  function buildFuse() {
    fusePath = new Array(FUSE_SAMPLES);
    for (let i = 0; i < FUSE_SAMPLES; i++) {
      // Tip first: t walks from 1 (the tip) back to 0 (the rocket base), so
      // index 0 is where the flame starts and the burn simply consumes the
      // front of the array.
      const t = 1 - i / (FUSE_SAMPLES - 1);
      fusePath[i] = {
        x: toWorldX(bezier(FUSE.x0, FUSE.c1x, FUSE.c2x, FUSE.x1, t)),
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
    buildFuse();
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
  function drawMatch(ctx, ctxAlpha, localX, localY, flick) {
    ctx.save();
    ctx.globalAlpha = ctxAlpha;
    ctx.translate(toWorldX(localX), toWorldY(localY));
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

  build();

  const api = {
    get state() {
      return state;
    },
    get scale() {
      return scale;
    },
    get fusePath() {
      return fusePath;
    },
    get burnProgress() {
      // 'launched' has to count as fully burnt. Falling back to 0 here is what
      // made the whole fuse reappear on the ground the instant the rocket
      // left: the burn had finished, but the state had moved on past it.
      if (state === 'launched') return 1;
      return state === 'burning' || state === 'burnt'
        ? clamp01(burnT / burnSeconds)
        : 0;
    },
    get fuseTipWorld() {
      return { x: toWorldX(TIP.x), y: toWorldY(TIP.y) };
    },
    get burnHeadWorld() {
      const p = api.burnProgress;
      const idx = Math.min(
        fusePath.length - 1,
        Math.floor(p * (fusePath.length - 1))
      );
      return fusePath[idx];
    },
    get rocketBaseWorld() {
      return {
        x: toWorldX(ROCKET_LOCAL.x),
        y: toWorldY(ROCKET_LOCAL.y),
        scale,
        stickLength: ROCKET_LOCAL.stick,
        topY: toWorldY(ROCKET_LOCAL.y) + ROCKET.topY * scale,
      };
    },
    get matchWorld() {
      return {
        x: toWorldX(MATCH.x),
        y: toWorldY(MATCH.y),
        angle: MATCH.angle,
      };
    },

    /** Local set-piece coordinates -> world coordinates. */
    localToWorld(lx, ly) {
      return { x: toWorldX(lx), y: toWorldY(ly) };
    },

    /** Stop the ring pulse and the ghost-match loop. Called on the tap. */
    stopIdleDemo() {
      demoRunning = false;
      if (state === 'idle') state = 'armed';
    },

    /**
     * Light the fuse at its tip. The burn walks from the tip toward the
     * rocket base over `seconds`; the consumed portion stops being drawn.
     */
    startFuseBurn(seconds = FUSE_BURN_SECONDS, strikeSeconds = STRIKE_TRAVEL) {
      api.stopIdleDemo();
      // The match has to physically reach the fuse before it can light it, so
      // the travel comes out of the same budget the burn was given. The
      // timeline owns the travel time, because the audio cue has to land on
      // the same instant the cord catches.
      strikeTravel = Math.max(0.05, strikeSeconds);
      burnSeconds = Math.max(0.3, seconds - strikeTravel);
      burnT = 0;
      strikeT = 0;
      burnDone = false;
      state = 'striking';
    },

    /** Hide the rocket so a later phase can draw the flying one instead. */
    setRocketVisible(visible) {
      rocketVisible = visible;
      if (!visible) state = 'launched';
    },

    /** Back to the opening frame, for replay. */
    reset() {
      time = 0;
      burnT = 0;
      strikeT = 0;
      burnDone = false;
      demoRunning = true;
      rocketVisible = true;
      state = 'idle';
    },

    update(dt) {
      time += dt;
      if (state === 'striking') {
        strikeT += dt;
        if (strikeT >= strikeTravel) {
          strikeT = strikeTravel;
          state = 'burning';
          burnT = 0;
        }
      }
      if (state === 'burning') {
        burnT += dt;
        if (burnT >= burnSeconds) {
          burnT = burnSeconds;
          state = 'burnt';
          if (!burnDone) {
            burnDone = true;
            if (options.onFuseComplete) options.onFuseComplete();
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

      // --- Fuse ----------------------------------------------------------
      // Drawn from the burn head to the rocket base; the burnt portion in
      // front of the head is simply not drawn.
      const progress = api.burnProgress;
      const last = fusePath.length - 1;
      const startIdx = Math.min(last, Math.floor(progress * last));
      if (startIdx < last) {
        ctx.strokeStyle = PALETTE.fuse;
        ctx.lineWidth = FUSE.width * scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fusePath[startIdx].x, fusePath[startIdx].y);
        for (let i = startIdx + 1; i <= last; i++) {
          ctx.lineTo(fusePath[i].x, fusePath[i].y);
        }
        ctx.stroke();
      }

      // --- Rocket --------------------------------------------------------
      if (rocketVisible) {
        drawRocket(
          ctx,
          toWorldX(ROCKET_LOCAL.x),
          toWorldY(ROCKET_LOCAL.y),
          scale,
          0,
          { stickLength: ROCKET_LOCAL.stick }
        );
      }

      // --- Unlit fuse tip ------------------------------------------------
      // Still unlit while the match is on its way over.
      if (state === 'idle' || state === 'armed' || state === 'striking') {
        ctx.fillStyle = PALETTE.fuse;
        ctx.beginPath();
        ctx.arc(toWorldX(TIP.x), toWorldY(TIP.y), TIP.r * scale, 0, TAU);
        ctx.fill();
      }

      // --- Pulsing ring on the fuse tip ----------------------------------
      if (demoRunning) {
        const u = (time % RING.period) / RING.period;
        const cx = toWorldX(RING.x);
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

      // --- Ghost demo -----------------------------------------------------
      if (demoRunning) {
        const u = (time % DEMO_PERIOD) / DEMO_PERIOD;

        // The flash at the tip, during the hold.
        sampleTrack(FLASH_KEYS, u, flashOut);
        if (flashOut.a > 0.01) {
          const fx = toWorldX(FLASH.x);
          const fy = toWorldY(FLASH.y);
          ctx.lineWidth = 1.5 * scale;
          ctx.lineCap = 'butt';
          for (let i = 0; i < flashSparks.length; i++) {
            const s = flashSparks[i];
            ctx.globalAlpha = flashOut.a * 0.26;
            ctx.strokeStyle = s.colour;
            ctx.beginPath();
            ctx.moveTo(fx + s.ix * scale, fy + s.iy * scale);
            ctx.lineTo(fx + s.ox * scale, fy + s.oy * scale);
            ctx.stroke();

            ctx.globalAlpha = flashOut.a * s.alpha;
            ctx.fillStyle = s.colour;
            ctx.beginPath();
            ctx.arc(
              fx + s.ox * scale,
              fy + s.oy * scale,
              s.size * scale,
              0,
              TAU
            );
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }

        // The ghosted match itself.
        sampleTrack(DEMO_KEYS, u, demoOut);
        if (demoOut.a > 0.01) {
          const flick =
            0.5 -
            0.5 * Math.cos((time / MATCH.flame.period) * TAU);
          drawMatch(
            ctx,
            demoOut.a,
            MATCH.x + demoOut.dx,
            MATCH.y + demoOut.dy,
            flick
          );
        }
      }

      // --- The real, lit match --------------------------------------------
      // At rest until the tap, then in to the fuse tip and back out again.
      if (state !== 'launched') {
        const flick =
          0.5 - 0.5 * Math.cos((time / MATCH.flame.period) * TAU);

        let reach = 0;
        if (state === 'striking') {
          // Ease-out on the way in, so it arrives rather than slams.
          const p = clamp01(strikeT / strikeTravel);
          reach = 1 - (1 - p) * (1 - p);
        } else if (state === 'burning' || state === 'burnt') {
          const q = clamp01(burnT / STRIKE_RETREAT);
          reach = 1 - q * q;
        }

        drawMatch(
          ctx,
          1,
          MATCH.x + STRIKE_TO.dx * reach,
          MATCH.y + STRIKE_TO.dy * reach,
          flick
        );
      }

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
