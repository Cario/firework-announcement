/**
 * Pre-allocated struct-of-arrays particle pool. No per-frame allocation.
 *
 * Phase 6.1 of docs/plans/01-implementation-plan.md.
 *
 * Every particle in the project — burst sparks, exhaust embers, smoke puffs and
 * the letter sparks that assemble the sky text — lives in this one pool. The
 * pool is sized once at construction and never grows, and neither `update()`
 * nor `render()` creates a single object, array, string or closure. That is a
 * hard requirement: Phase 6's verification profiles a burst in DevTools and
 * expects a flat allocation timeline.
 *
 * Storage is struct-of-arrays: one `Float32Array` per field rather than one
 * object per particle. Reading `x[i]` and `vx[i]` walks two tight contiguous
 * buffers instead of chasing 2600 heap objects, and there is nothing for the
 * garbage collector to trace.
 *
 * Slot management is swap-remove: live particles are packed into `[0, count)`,
 * and a dead one is overwritten by the last live one. That keeps every scan
 * dense, at the cost of draw order within a pass being arbitrary — which does
 * not matter, because ordering that *does* matter (smoke under everything) is
 * expressed as a separate render pass, not as slot order.
 *
 * RENDERING RULES (locked by the spec and repeated user corrections):
 * crisp filled points plus short directional streaks. No softening filters, no
 * glow halos, no radial gradients. Nothing in this file touches those.
 */

import { PALETTE } from '../config/palette.js';
import { clamp01, easeOutQuint } from '../engine/easing.js';
import { createUnseededRng } from '../engine/rng.js';

// --- Tuning constants (Phase 6.1) -------------------------------------------

/** Velocity retained per second: `v *= DRAG^dt`. */
const DRAG = 0.86;

/** Smoke is far draggier — a puff should stall almost where it was born. */
const SMOKE_DRAG = 0.5;

/** Downward acceleration, CSS px/s^2. Deliberately gentle: real firework
 *  sparks are tiny and air-braked, so a physical 9.8 m/s^2 reads as rain. */
const GRAVITY = 46;

/** Streak geometry: a 1.5 px line drawn from `p - v*STREAK_SECONDS` to `p`. */
const STREAK_SECONDS = 0.045;
const STREAK_WIDTH = 1.5;
const STREAK_ALPHA = 0.26;

/** Smoke puff radius envelope, in CSS px, over the puff's whole life. */
const SMOKE_R0 = 8;
const SMOKE_R1 = 62;
/** Smoke starting alpha, fading linearly to 0. */
const SMOKE_ALPHA = 0.3;

/** Letter sparks are parked, not decaying, so they get a life longer than the
 *  whole 30 s sequence. They leave the pool via `disperseGroup()`, not decay. */
const LETTER_LIFE = 90;

/**
 * Twinkle of a settled letter spark: alpha oscillates about this base.
 *
 * The swing is deliberately small. A wider one was tried and rejected: at
 * +/-0.3 the shimmer visibly cut strokes in half and letters lost their
 * counters, which for an audience that includes elderly readers is a straight
 * legibility loss for a decorative gain. 0.82 +/- 0.18 still breathes.
 */
const TWINKLE_BASE = 0.82;
const TWINKLE_SWING = 0.18;
const TWINKLE_RATE = 2.4;

/**
 * Spatial frequency of the twinkle wave. Low, so the shimmer travels across a
 * whole word rather than banding within a single letter.
 */
const TWINKLE_KX = 0.05;
const TWINKLE_KY = 0.03;

/** How long a dispersing letter spark takes to drift down and fade (plan 6.4). */
const DISPERSE_SECONDS = 0.6;

/** Micro-burst fired by a CRACKLE spark once 60% of its life has elapsed. */
const CRACKLE_AT = 0.6;
const CRACKLE_MIN = 3;
const CRACKLE_MAX = 5;

const TAU = Math.PI * 2;

// --- Colour table ------------------------------------------------------------

/**
 * Particles store a numeric `colorIndex`, never a string, so the pool stays
 * pure typed arrays. This is the index order; `COLOR` is the reverse lookup.
 *
 * Every entry resolves through `PALETTE`, so this file contains no colour
 * literal of its own (Phase 10 greps for that).
 */
export const COLOR_KEYS = [
  'gold',
  'goldHi',
  'whiteSpark',
  'green',
  'blue',
  'flame',
  'red',
  'redHi',
  'redLo',
  'smoke',
];

/** Name -> index. `COLOR.goldHi === 1`. */
export const COLOR = {};
for (let i = 0; i < COLOR_KEYS.length; i++) COLOR[COLOR_KEYS[i]] = i;
Object.freeze(COLOR);

/** Index -> hex string, resolved once at module load. */
const COLOR_VALUES = COLOR_KEYS.map((key) => PALETTE[key]);

/**
 * Resolve a colour name (or an already-numeric index) to a pool colour index.
 * Unknown names fall back to gold rather than throwing — a mistyped colour
 * should never be able to stall the sequence.
 *
 * @param {string|number} name
 * @returns {number}
 */
export function colorIndexOf(name) {
  if (typeof name === 'number') return name | 0;
  const idx = COLOR[name];
  return idx === undefined ? COLOR.gold : idx;
}

// --- Particle kinds ----------------------------------------------------------

/**
 * `kind` selects the integration and render rules for a slot.
 *
 * SPARK       ballistic, drag + gravity, fades and shrinks with life
 * CRACKLE     a SPARK that pops a 3-5 spark micro-burst at 60% of its life,
 *             then becomes an ordinary SPARK (this is the crackle effect)
 * EMBER       exhaust ember: ballistic, but fades by opacity only, never shrinks
 * SMOKE       exhaust puff: no gravity, heavy drag, grows 8 -> 62 px, drawn in
 *             its own pass underneath everything else
 * LETTER      a text spark in flight, easing from ballistic motion onto its
 *             target glyph point
 * LETTER_SET  the same spark after arrival: parked on the glyph, twinkling
 */
export const KIND = Object.freeze({
  SPARK: 0,
  CRACKLE: 1,
  EMBER: 2,
  SMOKE: 3,
  LETTER: 4,
  LETTER_SET: 5,
});

/**
 * Particle budget. The plan's Phase 6.1 figures were 2600 / 1400, but the
 * longest invitation line is twelve words that must ALL be legible on screen
 * at once. At 1400 that works out to ~72 dots for a word like "Muhammad",
 * which renders as a blob rather than letters — measured on a 428 px viewport,
 * not guessed. These are plain filled arcs with no shadow or blur, so the
 * extra headroom costs far less than the legibility it buys.
 *
 * `navigator.hardwareConcurrency` is `undefined` on some browsers; `undefined
 * <= 4` is false, so an unknown core count is treated as a capable device.
 *
 * @returns {number}
 */
export function particleCap() {
  let narrow = false;
  try {
    narrow = window.matchMedia('(max-width: 760px)').matches;
  } catch {
    narrow = false;
  }
  const lowCore =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency <= 4;
  return narrow || lowCore ? 2400 : 3800;
}

/**
 * Build the pool.
 *
 * @param {{ max?: number, rng?: { next: () => number, range: (a: number, b: number) => number, int: (a: number, b: number) => number } }} [options]
 *   `max` overrides the auto-detected cap (used by tests and the harness).
 *   `rng` overrides the spark random stream; sparks default to an unseeded one
 *   so no two bursts look cloned (plan 2.7).
 */
export function createParticles(options) {
  const max = (options && options.max) || particleCap();
  const rng = (options && options.rng) || createUnseededRng();

  // --- The nine fields named in plan 6.1 ...
  const x = new Float32Array(max);
  const y = new Float32Array(max);
  const vx = new Float32Array(max);
  const vy = new Float32Array(max);
  const life = new Float32Array(max);
  const maxLife = new Float32Array(max);
  const size = new Float32Array(max);
  const colorIndex = new Float32Array(max);
  const kind = new Float32Array(max);

  // --- ...plus five the text resolve needs.
  //
  // DEVIATION, stated plainly: plan 6.1 lists nine fields, but plan 6.4 asks
  // each text spark to ease from ballistic motion onto a specific glyph point
  // over its own staggered window, and plan 6.5 puts several words on screen at
  // once that must disperse independently. That is per-particle state, so it
  // needs per-particle storage. These follow the same rule as the nine above —
  // one pre-allocated Float32Array each, never resized, never boxed.
  const tx = new Float32Array(max); // resolve target x
  const ty = new Float32Array(max); // resolve target y
  const delay = new Float32Array(max); // seconds before the resolve ease starts
  const dur = new Float32Array(max); // seconds the resolve ease lasts
  const group = new Float32Array(max); // word id, for disperseGroup()

  /** Live particles occupy [0, count). */
  let count = 0;

  /** Seconds since construction. Drives the letter twinkle. */
  let time = 0;

  /**
   * Overwrite slot `i` with slot `j`. Used by swap-remove; every field must be
   * copied or a particle inherits a stale target and teleports.
   */
  function copySlot(i, j) {
    x[i] = x[j];
    y[i] = y[j];
    vx[i] = vx[j];
    vy[i] = vy[j];
    life[i] = life[j];
    maxLife[i] = maxLife[j];
    size[i] = size[j];
    colorIndex[i] = colorIndex[j];
    kind[i] = kind[j];
    tx[i] = tx[j];
    ty[i] = ty[j];
    delay[i] = delay[j];
    dur[i] = dur[j];
    group[i] = group[j];
  }

  /** Retire slot `i`; the last live particle takes its place. */
  function kill(i) {
    count--;
    if (i !== count) copySlot(i, count);
  }

  /** Rolling start point for the eviction scan below. */
  let evictCursor = 0;

  /**
   * Claim a free slot.
   *
   * When the pool is full a new particle is normally dropped — losing one spark
   * out of 2600 is invisible. A LETTER is not droppable, though: a missing
   * letter spark leaves a visible hole in a word. So a letter evicts an
   * ordinary particle instead, found by a short bounded scan (never a full
   * sweep, which would make a full pool quadratic).
   *
   * @returns {number} slot index, or -1 if the spawn should be dropped.
   */
  function claim(wantKind) {
    if (count < max) return count++;
    if (wantKind !== KIND.LETTER) return -1;
    const scan = max < 64 ? max : 64;
    for (let n = 0; n < scan; n++) {
      const i = (evictCursor + n) % count;
      const k = kind[i];
      if (k !== KIND.LETTER && k !== KIND.LETTER_SET) {
        evictCursor = (i + 1) % count;
        return i;
      }
    }
    return -1;
  }

  /**
   * Spawn one particle. All-primitive arguments on purpose: an options object
   * here would allocate once per spark, which is exactly the churn the pool
   * exists to avoid.
   *
   * @param {number} k        one of KIND.*
   * @param {number} px       position
   * @param {number} py
   * @param {number} pvx      velocity, CSS px/s
   * @param {number} pvy
   * @param {number} pLife    seconds
   * @param {number} pSize    radius in CSS px (for SMOKE: a scale multiplier)
   * @param {number} pColor   index into COLOR_KEYS
   * @param {number} [pGroup] word id, only meaningful for letters
   * @returns {number} the slot index, or -1 if the pool was full.
   */
  function spawn(k, px, py, pvx, pvy, pLife, pSize, pColor, pGroup) {
    const i = claim(k);
    if (i < 0) return -1;
    x[i] = px;
    y[i] = py;
    vx[i] = pvx;
    vy[i] = pvy;
    life[i] = pLife;
    maxLife[i] = pLife;
    size[i] = pSize;
    colorIndex[i] = pColor;
    kind[i] = k;
    tx[i] = 0;
    ty[i] = 0;
    delay[i] = 0;
    dur[i] = 0;
    group[i] = pGroup === undefined ? 0 : pGroup;
    return i;
  }

  /**
   * Spawn a text spark: born at the burst origin with an outward velocity,
   * easing onto `(targetX, targetY)` over `duration` seconds after `startDelay`.
   *
   * @param {number} px      birth position (the burst origin)
   * @param {number} py
   * @param {number} pvx     initial outward velocity
   * @param {number} pvy
   * @param {number} targetX glyph point, absolute CSS px
   * @param {number} targetY
   * @param {number} startDelay
   * @param {number} duration
   * @param {number} pSize   1.6 or 2.6, alternating along the glyph
   * @param {number} pColor
   * @param {number} pGroup  word id for disperseGroup()
   * @returns {number} slot index or -1.
   */
  function spawnLetter(
    px,
    py,
    pvx,
    pvy,
    targetX,
    targetY,
    startDelay,
    duration,
    pSize,
    pColor,
    pGroup
  ) {
    const i = spawn(
      KIND.LETTER,
      px,
      py,
      pvx,
      pvy,
      LETTER_LIFE,
      pSize,
      pColor,
      pGroup
    );
    if (i < 0) return -1;
    tx[i] = targetX;
    ty[i] = targetY;
    delay[i] = startDelay;
    dur[i] = duration > 0 ? duration : 0.0001;
    return i;
  }

  /**
   * Release a word: gravity is restored and its sparks drift down and fade over
   * ~0.6 s (plan 6.4). Safe to call on a group that is already gone.
   *
   * @param {number} g word id
   * @returns {number} how many sparks were released.
   */
  function disperseGroup(g) {
    let n = 0;
    for (let i = 0; i < count; i++) {
      const k = kind[i];
      if (k !== KIND.LETTER && k !== KIND.LETTER_SET) continue;
      if (group[i] !== g) continue;
      // Park it at wherever it is being drawn right now, so the handover from
      // "settling onto the glyph" to "falling away" has no positional jump.
      x[i] = drawX(i);
      y[i] = drawY(i);
      kind[i] = KIND.SPARK;
      vx[i] = rng.range(-9, 9);
      vy[i] = rng.range(4, 26);
      const l = DISPERSE_SECONDS * rng.range(0.85, 1.15);
      life[i] = l;
      maxLife[i] = l;
      n++;
    }
    return n;
  }

  /** Remove a word's sparks outright, with no fall-and-fade. */
  function clearGroup(g) {
    let i = 0;
    while (i < count) {
      const k = kind[i];
      if ((k === KIND.LETTER || k === KIND.LETTER_SET) && group[i] === g) {
        kill(i);
        continue;
      }
      i++;
    }
  }

  /** How many sparks a word still owns (resolving or settled). */
  function groupCount(g) {
    let n = 0;
    for (let i = 0; i < count; i++) {
      const k = kind[i];
      if ((k === KIND.LETTER || k === KIND.LETTER_SET) && group[i] === g) n++;
    }
    return n;
  }

  /**
   * True once every spark of the word has landed on its glyph point — i.e. the
   * word is fully assembled and legible. The director uses this to time the
   * hold before dispersing.
   */
  function groupResolved(g) {
    let seen = false;
    for (let i = 0; i < count; i++) {
      if (group[i] !== g) continue;
      const k = kind[i];
      if (k === KIND.LETTER) return false;
      if (k === KIND.LETTER_SET) seen = true;
    }
    return seen;
  }

  // --- Drawn position ---------------------------------------------------------
  //
  // For every kind except LETTER, the drawn position IS the stored position.
  // A LETTER stores its *ballistic* position and is drawn at a lerp from there
  // onto its target — that is what makes a flare look like it flew out and then
  // settled rather than being teleported onto the glyph.

  /** Resolve progress of slot `i`, eased. 0 = pure ballistic, 1 = on target. */
  function resolveEase(i) {
    const age = maxLife[i] - life[i];
    return easeOutQuint(clamp01((age - delay[i]) / dur[i]));
  }

  function drawX(i) {
    if (kind[i] !== KIND.LETTER) return x[i];
    const e = resolveEase(i);
    return x[i] + (tx[i] - x[i]) * e;
  }

  function drawY(i) {
    if (kind[i] !== KIND.LETTER) return y[i];
    const e = resolveEase(i);
    return y[i] + (ty[i] - y[i]) * e;
  }

  /**
   * Fire a CRACKLE particle's micro-burst: 3-5 short-lived sparks of the same
   * colour, inheriting a fraction of the parent's velocity.
   */
  function crackle(i) {
    const n = CRACKLE_MIN + ((rng.next() * (CRACKLE_MAX - CRACKLE_MIN + 1)) | 0);
    const px = x[i];
    const py = y[i];
    const pvx = vx[i] * 0.35;
    const pvy = vy[i] * 0.35;
    const c = colorIndex[i];
    const s = size[i] * 0.62;
    for (let j = 0; j < n; j++) {
      const a = rng.next() * TAU;
      const sp = rng.range(20, 52);
      spawn(
        KIND.SPARK,
        px,
        py,
        pvx + Math.cos(a) * sp,
        pvy + Math.sin(a) * sp * 0.82,
        rng.range(0.26, 0.5),
        s,
        c,
        0
      );
    }
  }

  /**
   * Advance the simulation.
   *
   * Allocation-free by construction: the drag factors are computed once per
   * call, the loop indexes typed arrays only, and the only function calls are
   * to `Math` and to `spawn` (which itself allocates nothing).
   *
   * @param {number} dt seconds, already clamped by the loop.
   */
  function update(dt) {
    if (dt <= 0) return;
    time += dt;

    // `v *= drag^dt` — framerate-independent exponential decay, evaluated once
    // for the whole pool rather than per particle.
    const dragF = Math.pow(DRAG, dt);
    const smokeDragF = Math.pow(SMOKE_DRAG, dt);
    const gdt = GRAVITY * dt;

    let i = 0;
    while (i < count) {
      const k = kind[i];

      if (k === KIND.SMOKE) {
        // No gravity: a puff hangs and spreads, it does not fall.
        vx[i] *= smokeDragF;
        vy[i] *= smokeDragF;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
      } else if (k === KIND.LETTER_SET) {
        // Parked on the glyph. Nothing to integrate; it only twinkles.
      } else {
        vx[i] *= dragF;
        vy[i] *= dragF;
        vy[i] += gdt;
        x[i] += vx[i] * dt;
        y[i] += vy[i] * dt;
      }

      life[i] -= dt;

      if (k === KIND.CRACKLE && life[i] <= maxLife[i] * (1 - CRACKLE_AT)) {
        // Note: `crackle` appends to the pool, and because the loop bound is
        // read live those new sparks are integrated once more this frame. One
        // extra sub-16 ms step on a 0.3 s spark is not observable, and the
        // alternative (a pending queue) would allocate.
        crackle(i);
        kind[i] = KIND.SPARK;
      } else if (k === KIND.LETTER && resolveEase(i) >= 1) {
        // Arrival: snap to the target exactly and stop moving, so the glyph is
        // pixel-accurate rather than approximately right.
        kind[i] = KIND.LETTER_SET;
        x[i] = tx[i];
        y[i] = ty[i];
        vx[i] = 0;
        vy[i] = 0;
      }

      if (life[i] <= 0) {
        kill(i);
        continue; // slot i now holds an unprocessed particle
      }
      i++;
    }
  }

  /** Alpha for slot `i`, by kind. */
  function alphaOf(i, k, ratio) {
    if (k === KIND.SMOKE) return SMOKE_ALPHA * ratio;
    if (k === KIND.LETTER) return 1;
    if (k === KIND.LETTER_SET) {
      // Phase derived from the target point rather than stored, so it survives
      // swap-remove and reads as a shimmer travelling across the word instead
      // of 700 independent flickers.
      const phase = tx[i] * TWINKLE_KX + ty[i] * TWINKLE_KY;
      return TWINKLE_BASE + TWINKLE_SWING * Math.sin(time * TWINKLE_RATE + phase);
    }
    return ratio;
  }

  /** Radius for slot `i`, by kind. Smoke grows; embers and letters do not. */
  function radiusOf(i, k, ratio) {
    if (k === KIND.SMOKE) return (SMOKE_R0 + (SMOKE_R1 - SMOKE_R0) * (1 - ratio)) * size[i];
    if (k === KIND.SPARK || k === KIND.CRACKLE) return size[i] * (0.45 + 0.55 * ratio);
    return size[i];
  }

  /**
   * Draw the pool.
   *
   * Three passes, in this order:
   *   1. smoke  — soft-edged only in the sense of being large and translucent;
   *               still a flat filled circle, no gradient, no filter
   *   2. streaks — 1.5 px directional lines at a constant 0.26 alpha
   *   3. points  — the filled circles, on top
   *
   * Passes 2 and 3 iterate colour-major (ten short sweeps rather than one) so
   * `fillStyle` / `strokeStyle` is assigned ten times a frame instead of up to
   * 2600 times. Because every streak shares one alpha, the whole streak pass
   * for a colour is a single `beginPath` / `stroke`.
   *
   * The caller draws the exhaust flame and the rocket sprite AFTER this, which
   * is what produces the plan 5.3 order: smoke < embers < flame < rocket.
   *
   * @param {CanvasRenderingContext2D} ctx
   */
  function render(ctx) {
    if (count === 0) return;

    // The passes below set globalAlpha, lineWidth, lineCap, fillStyle and
    // strokeStyle. save/restore keeps that contained, so the scene code that
    // draws before and after never inherits state from the particle pass.
    ctx.save();

    // --- Pass 1: smoke, underneath everything.
    let any = false;
    for (let i = 0; i < count; i++) {
      if (kind[i] !== KIND.SMOKE) continue;
      if (!any) {
        ctx.fillStyle = COLOR_VALUES[COLOR.smoke];
        any = true;
      }
      const ratio = clamp01(life[i] / maxLife[i]);
      ctx.globalAlpha = SMOKE_ALPHA * ratio;
      const r = radiusOf(i, KIND.SMOKE, ratio);
      ctx.beginPath();
      ctx.arc(x[i], y[i], r, 0, TAU);
      ctx.fill();
    }

    // --- Pass 2: streaks. One path per colour; constant alpha lets it batch.
    ctx.globalAlpha = STREAK_ALPHA;
    ctx.lineWidth = STREAK_WIDTH;
    ctx.lineCap = 'round';
    for (let c = 0; c < COLOR_VALUES.length; c++) {
      let opened = false;
      for (let i = 0; i < count; i++) {
        if (colorIndex[i] !== c) continue;
        const k = kind[i];
        // Smoke has no direction worth drawing; a settled letter is stationary.
        if (k === KIND.SMOKE || k === KIND.LETTER_SET) continue;
        let sx = vx[i];
        let sy = vy[i];
        if (k === KIND.LETTER) {
          // Fade the streak out as the spark settles, so the trail vanishes at
          // the instant it becomes part of the letterform.
          const t = 1 - resolveEase(i);
          sx *= t;
          sy *= t;
        }
        const px = drawX(i);
        const py = drawY(i);
        const ax = px - sx * STREAK_SECONDS;
        const ay = py - sy * STREAK_SECONDS;
        // Skip degenerate segments: a zero-length stroke with a round cap
        // paints a dot that would double the particle's apparent brightness.
        if ((px - ax) * (px - ax) + (py - ay) * (py - ay) < 0.25) continue;
        if (!opened) {
          ctx.strokeStyle = COLOR_VALUES[c];
          ctx.beginPath();
          opened = true;
        }
        ctx.moveTo(ax, ay);
        ctx.lineTo(px, py);
      }
      if (opened) ctx.stroke();
    }

    // --- Pass 3: the points themselves, on top.
    for (let c = 0; c < COLOR_VALUES.length; c++) {
      let opened = false;
      for (let i = 0; i < count; i++) {
        if (colorIndex[i] !== c) continue;
        const k = kind[i];
        if (k === KIND.SMOKE) continue;
        if (!opened) {
          ctx.fillStyle = COLOR_VALUES[c];
          opened = true;
        }
        const ratio = clamp01(life[i] / maxLife[i]);
        const a = alphaOf(i, k, ratio);
        if (a <= 0.004) continue;
        ctx.globalAlpha = a > 1 ? 1 : a;
        ctx.beginPath();
        ctx.arc(drawX(i), drawY(i), radiusOf(i, k, ratio), 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** Empty the pool. Used by replay (plan 8.2) so nothing survives a reset. */
  function reset() {
    count = 0;
    evictCursor = 0;
    time = 0;
  }

  return {
    spawn,
    spawnLetter,
    disperseGroup,
    clearGroup,
    groupCount,
    groupResolved,
    update,
    render,
    reset,
    colorIndexOf,
    KIND,
    COLOR,
    /** Live particle count — the Phase 8.2 leak check reads this. */
    get count() {
      return count;
    },
    /** Pool capacity. Constant for the lifetime of the system. */
    get max() {
      return max;
    },
    /** Seconds since construction; drives the letter twinkle. */
    get time() {
      return time;
    },
    /** The spark random stream, shared so emitters do not each make their own. */
    rng,
  };
}
