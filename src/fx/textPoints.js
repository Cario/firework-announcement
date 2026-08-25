/**
 * Glyph point sampling so sky text is formed by the sparks themselves.
 *
 * Phase 6.3 / 6.4 / 6.5 of docs/plans/01-implementation-plan.md. This is the
 * key mechanism of the project: the words are never drawn with `fillText` on
 * the visible canvas. They are rasterised once into an offscreen canvas, the
 * lit pixels are read back as a point cloud, and sparks fly out of a burst and
 * settle onto those points. What the viewer reads is made of embers.
 *
 * Three things in here are easy to get wrong and expensive to notice late:
 *
 *  1. THE FONT GUARD. `ctx.font = '600 40px "Cormorant Garamond", Georgia,
 *     serif'` silently falls back to Georgia if the webfont has not arrived
 *     yet, and Georgia-shaped points look plausible — you only spot it by
 *     comparing letterforms. So: `await ensureFontsReady()` before the first
 *     sample, record `document.fonts.check(...)` at sample time, and re-sample
 *     any cache entry that was taken while the check was false.
 *  2. RADIAL ORDER. Points come back sorted by distance from the glyph centre,
 *     so staggering the resolve by array index makes the word bloom outward
 *     instead of assembling left-to-right like a typewriter.
 *  3. LETTER SPACING. `ctx.letterSpacing` is not on the Phase 0 allow-list and
 *     its support history is uneven, so tracking is applied by measuring and
 *     placing each character by hand. Kerning is only lost on the tracked path
 *     (SURPRISE, all caps, where tracking is the point); the italic sentence
 *     lines are drawn as a single `fillText` and keep their kerning.
 *
 * `getImageData` here reads a canvas this module drew itself, so the canvas is
 * never tainted. It is still wrapped in a try/catch: plan 9.4 requires that a
 * sampling failure degrade to plain text rather than stall the sequence.
 */

import { PALETTE } from '../config/palette.js';
import { colorIndexOf } from './particles.js';
import { createRng, hashString } from '../engine/rng.js';

/** The display face. Georgia is the fallback the font guard exists to detect. */
export const DISPLAY_FAMILY = '"Cormorant Garamond", Georgia, serif';

/** The exact probe string plan 6.3 names for the readiness check. */
const FONT_PROBE = `600 40px ${DISPLAY_FAMILY}`;

/** Alpha above which a sampled pixel counts as ink (plan 6.3 step 4). */
const ALPHA_THRESHOLD = 128;

/** Positional jitter applied to every kept point, in CSS px (plan 6.3 step 5). */
const POINT_JITTER = 0.8;

/** Letter spark sizes, alternating for the fine dotted texture (plan 6.4). */
const LETTER_SIZE_A = 1.6;
const LETTER_SIZE_B = 2.6;

/** Resolve duration window, staggered by radial index (plan 6.4). */
const RESOLVE_MIN_SECONDS = 0.55;
const RESOLVE_MAX_SECONDS = 0.95;

/** Row width budget and font-size clamp for line layout (plan 6.5). */
const ROW_WIDTH_FRACTION = 0.88;
const FONT_MIN = 18;
const FONT_MAX = 46;
const FONT_VW = 0.046;
/**
 * Row pitch. Generous on purpose: the words are scattered off their baseline
 * by the altitude jitter below, and at 1.25 an ascender from one row lands in
 * the descenders of the one above it — measured, not theorised.
 */
const LINE_HEIGHT = 1.62;

/** Vertical jitter per word, as a fraction of viewport height (plan 6.5). */
const ALTITUDE_JITTER = 0.06;

/** Vertical safe band; nothing is ever laid out outside it. */
const SAFE_TOP = 0.12;
const SAFE_BOTTOM = 0.88;

/**
 * A line of this many words or more is split across at least two rows even when
 * it would fit on one.
 *
 * Plan 6.5 asks for the 12-13 word lines to become 2 rows on desktop. Left to
 * pure width packing they do not: at 1440 px the whole of line 2 fits one row
 * at 46 px with 5 px to spare, which both breaks the stated layout and defeats
 * the "fireworks at different altitudes" read the vertical jitter exists for.
 */
const BALANCE_MIN_WORDS = 9;

/** Slack allowed when balancing rows, so the split lands cleanly at a space. */
const BALANCE_SLACK = 1.12;

/** Reference size used for proportional measurement during the size search. */
const MEASURE_REF = 100;

// --- Shared offscreen canvases ----------------------------------------------
//
// `document.createElement('canvas')`, deliberately not `OffscreenCanvas`
// (plan Phase 0: Safari support history, and there is no benefit here).
// Two of them: one 1x1 that only ever measures, and one that is resized per
// sample and actually rasterised.

let measureCanvas = null;
let measureCtx = null;

function getMeasureCtx() {
  if (!measureCtx) {
    measureCanvas = document.createElement('canvas');
    measureCanvas.width = 1;
    measureCanvas.height = 1;
    measureCtx = measureCanvas.getContext('2d');
  }
  return measureCtx;
}

let sampleCanvas = null;
let sampleCtx = null;

function getSampleCtx(w, h) {
  if (!sampleCanvas) {
    sampleCanvas = document.createElement('canvas');
    sampleCtx = sampleCanvas.getContext('2d');
  }
  // Assigning width/height also clears the surface, which is required — a
  // previous, wider sample would otherwise leave ink in the margins.
  sampleCanvas.width = w;
  sampleCanvas.height = h;
  return sampleCtx;
}

/**
 * Build a canvas font shorthand.
 *
 * @param {number} size px
 * @param {boolean} italic italic for the sentence lines, upright for SURPRISE
 * @param {number} [weight=600]
 */
export function fontString(size, italic, weight) {
  const w = weight === undefined ? 600 : weight;
  return `${italic ? 'italic ' : ''}${w} ${size}px ${DISPLAY_FAMILY}`;
}

// --- Font guard --------------------------------------------------------------

/** The two faces the sky text uses: upright for SURPRISE, italic for the lines. */
const REQUIRED_FACES = [`600 40px ${DISPLAY_FAMILY}`, `italic 600 40px ${DISPLAY_FAMILY}`];

/**
 * Resolve once the display face is actually available.
 *
 * Must be awaited before the first `samplePoints` call.
 *
 * `await document.fonts.ready` on its own is NOT sufficient here, and this was
 * confirmed by observation rather than assumed. A browser only fetches a
 * `@font-face` when some *rendered element* needs it; setting `ctx.font` on a
 * canvas does not count. On a page whose only consumer of Cormorant Garamond is
 * this module, `document.fonts.ready` resolves immediately with every face
 * still `unloaded`, `document.fonts.check()` returns false, and the sample
 * comes back Georgia-shaped — which is precisely the silent failure plan 6.3
 * warns about. So the faces are requested explicitly first, and only then is
 * `document.fonts.ready` awaited.
 *
 * Everything is guarded: a browser without the CSS Font Loading API, a blocked
 * Google Fonts request, or a document that never settles must degrade to the
 * Georgia fallback (plan 9.4) rather than hang the sequence.
 *
 * @returns {Promise<boolean>} whether "Cormorant Garamond" is usable afterwards.
 */
export async function ensureFontsReady() {
  try {
    if (document.fonts) {
      if (document.fonts.load) {
        await Promise.all(
          REQUIRED_FACES.map((f) => document.fonts.load(f).catch(() => null))
        );
      }
      if (document.fonts.ready) await document.fonts.ready;
    }
  } catch {
    /* no font loading API — fall through to the check below */
  }
  return fontsUsable();
}

/**
 * The literal plan 6.3 check: is the display face actually available right now?
 *
 * Returns false rather than throwing on browsers with no `document.fonts`, so
 * every sample taken there is marked stale-but-usable and simply never gets a
 * better re-sample.
 *
 * @returns {boolean}
 */
export function fontsUsable() {
  try {
    return !!(document.fonts && document.fonts.check(FONT_PROBE));
  } catch {
    return false;
  }
}

// --- Sampling ----------------------------------------------------------------

/**
 * Cache of sampled point clouds, keyed by everything that changes the result.
 * Entries record whether the webfont was present when they were taken; a stale
 * entry is re-sampled automatically the moment the font becomes available.
 *
 * @type {Map<string, object>}
 */
const cache = new Map();

/**
 * Drop the cache. Call on resize (plan 6.3: "re-sample on resize") — every
 * cached cloud was rasterised at a size derived from the old viewport.
 */
export function invalidatePointCache() {
  cache.clear();
}

/** Cached cloud count, for diagnostics and the harness. */
export function pointCacheSize() {
  return cache.size;
}

/**
 * Measure a string at a given size, honouring manual tracking.
 *
 * @returns {number} advance width in CSS px.
 */
export function measureDisplayText(text, size, italic, letterSpacing) {
  const ctx = getMeasureCtx();
  ctx.font = fontString(size, italic);
  if (!letterSpacing) return ctx.measureText(text).width;
  let w = 0;
  for (let i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width;
  return w + letterSpacing * Math.max(0, text.length - 1);
}

/**
 * Sample a string into a point cloud, with metrics.
 *
 * Coordinates are returned RELATIVE TO THE GLYPH CENTRE, so placing the word is
 * `point.x + centreX, point.y + centreY` with no metric bookkeeping at the call
 * site.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.fontSize=46]
 * @param {boolean} [opts.italic=false]  italic for sentence lines
 * @param {number} [opts.letterSpacing=0] px of tracking, for SURPRISE
 * @param {number} [opts.maxWidth]       shrink the size until the string fits
 * @param {number} [opts.density]        grid step in px; defaults to 4-7 by size
 * @param {number} [opts.maxPoints=900]  decimation ceiling, so one long word
 *                                       cannot swallow the whole particle pool
 * @returns {{ points: {x:number,y:number}[], width: number, height: number,
 *             fontSize: number, density: number, fontReady: boolean,
 *             failed: boolean }}
 */
export function samplePointsInfo(text, opts) {
  const o = opts || {};
  const italic = o.italic === true;
  const letterSpacing = o.letterSpacing || 0;
  const requested = o.fontSize === undefined ? FONT_MAX : o.fontSize;
  const maxWidth = o.maxWidth === undefined ? 0 : o.maxWidth;
  const maxPoints = o.maxPoints === undefined ? 900 : o.maxPoints;

  // Bucket maxWidth so a one-pixel viewport nudge does not orphan every entry.
  const key = `${text}|${requested.toFixed(2)}|${italic ? 'i' : 'u'}|${letterSpacing}|${
    o.density || 0
  }|${maxWidth ? Math.round(maxWidth / 8) : 0}|${maxPoints}`;

  const hit = cache.get(key);
  // THE GUARD: a cloud taken before the webfont arrived is Georgia-shaped.
  // Keep serving it (better than nothing) but re-sample as soon as the real
  // face is available.
  if (hit && (hit.fontReady || !fontsUsable())) return hit;

  const info = sampleUncached(text, requested, italic, letterSpacing, maxWidth, o.density, maxPoints);
  cache.set(key, info);
  return info;
}

/**
 * `samplePoints(text, { font, maxWidth, density }) -> [{x, y}]` — the exact
 * plan 6.3 surface. Points are relative to the glyph centre and in radial
 * order. Use `samplePointsInfo` when the metrics are needed too.
 */
export function samplePoints(text, opts) {
  return samplePointsInfo(text, opts).points;
}

function sampleUncached(text, requested, italic, letterSpacing, maxWidth, densityOpt, maxPoints) {
  const fontReady = fontsUsable();

  let fontSize = requested;
  let spacing = letterSpacing;
  let width = measureDisplayText(text, fontSize, italic, spacing);

  // Fit to maxWidth. Advance widths are essentially linear in font size, so one
  // corrective pass lands within a pixel; a second guarantees it.
  if (maxWidth > 0 && width > maxWidth) {
    for (let pass = 0; pass < 2 && width > maxWidth; pass++) {
      const scale = maxWidth / width;
      fontSize *= scale;
      spacing *= scale;
      width = measureDisplayText(text, fontSize, italic, spacing);
    }
  }

  // Grid step, proportional to font size (plan 6.3 step 4).
  //
  // DEVIATION, stated plainly: the plan's band is 4-7 px and this floors at 3.
  // The band holds for the sizes it was written about — SURPRISE at 57-96 px
  // samples at 4-7 and looks exactly right. It does not hold for the sentence
  // lines. A word set at 35 px has stems about 3 px wide, so a 4 px grid puts
  // FEWER than one dot across a stroke, and the rendered word is a scatter of
  // unrelated dots. That was not a guess: it was rendered at 320 px, screenshot,
  // and found illegible, which fails the spec's overriding requirement that
  // elderly readers can read this. A 3 px grid with the plan's 1.6/2.6 px spark
  // radii gives dots that just touch, so strokes read continuous while still
  // clearly built from embers.
  let density = densityOpt || Math.round(fontSize * 0.075);
  if (density < 3) density = 3;
  if (density > 7) density = 7;

  const pad = Math.ceil(fontSize * 0.4);
  const canvasW = Math.max(2, Math.ceil(width) + pad * 2);
  const canvasH = Math.max(2, Math.ceil(fontSize * 2));
  const cx = canvasW / 2;
  const cy = canvasH / 2;

  const ctx = getSampleCtx(canvasW, canvasH);
  ctx.font = fontString(fontSize, italic);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // White on transparent — only the alpha channel is read, but a bright fill
  // keeps the antialiased edge well above the threshold.
  ctx.fillStyle = PALETTE.whiteSpark;

  const startX = cx - width / 2;
  if (!spacing) {
    ctx.fillText(text, startX, cy);
  } else {
    // Manual tracking; see the module header for why not `ctx.letterSpacing`.
    let penX = startX;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      ctx.fillText(ch, penX, cy);
      penX += ctx.measureText(ch).width + spacing;
    }
  }

  let image;
  try {
    image = ctx.getImageData(0, 0, canvasW, canvasH);
  } catch {
    // Plan 9.4: never stall. The caller falls back to plain canvas text.
    return {
      points: [],
      width,
      height: fontSize,
      fontSize,
      density,
      fontReady,
      failed: true,
    };
  }

  const data = image.data;

  /** Walk the raster on a `step` px grid, keeping every sample above the
   *  alpha threshold. Coordinates come back relative to the glyph centre. */
  function scan(step) {
    const out = [];
    for (let py = 0; py < canvasH; py += step) {
      const rowBase = py * canvasW;
      for (let px = 0; px < canvasW; px += step) {
        // +3 reads the alpha byte of the RGBA quad.
        if (data[(rowBase + px) * 4 + 3] > ALPHA_THRESHOLD) {
          out.push(px - cx, py - cy);
        }
      }
    }
    return out;
  }

  // Fit the budget by COARSENING THE GRID first, and only decimate as a last
  // resort. Both thin the cloud, but a coarser grid thins it evenly and leaves
  // every stroke intact, whereas decimation removes points in raster order and
  // punches ragged holes through the letterforms.
  let raw = scan(density);
  while (raw.length / 2 > maxPoints && density < 7) {
    density++;
    raw = scan(density);
  }

  const total = raw.length / 2;

  // Decimate BEFORE the radial sort, so the thinned cloud keeps the glyph's
  // shape rather than losing one end of it. The stride is fractional and
  // carried in an accumulator: an integer stride would jump from "keep all" to
  // "keep half" the moment the budget is exceeded by one point, and a word
  // would visibly halve in density as the viewport crossed a threshold.
  const stride = total > maxPoints ? total / maxPoints : 1;

  // Jitter is seeded on the text, so a resize re-sample produces the identical
  // cloud and the word does not visibly twitch.
  const rng = createRng(hashString(`nikkah.points|${text}|${Math.round(fontSize)}`));

  const points = [];
  for (let cursor = 0; cursor < total; cursor += stride) {
    const i = cursor | 0;
    points.push({
      x: raw[i * 2] + rng.jitter(POINT_JITTER),
      y: raw[i * 2 + 1] + rng.jitter(POINT_JITTER),
    });
  }

  // Radial order from the glyph centre: the resolve then reads as an outward
  // bloom instead of a scanline.
  points.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));

  return {
    points,
    width,
    height: fontSize,
    fontSize,
    density,
    fontReady,
    failed: false,
  };
}

// --- Text resolve animation (plan 6.4) ---------------------------------------

/** Auto-allocated word ids, so callers never have to invent unique numbers. */
let groupSeq = 1;

/** Next unused word id. */
export function nextTextGroup() {
  return groupSeq++;
}

/**
 * Fly a point cloud out of a burst and settle it into the letterform.
 *
 * Each spark is born at the burst origin with an outward velocity, then over
 * 0.55-0.95 s (staggered by radial index) eases from that ballistic motion onto
 * its target point with `easeOutQuint`. On arrival it becomes a stationary
 * letter spark with a slow twinkle. Both halves of that live in
 * `particles.js` — this function only seeds them.
 *
 * The word holds until the caller runs `disperseText`, which restores gravity
 * so the sparks drift down and fade over 0.6 s.
 *
 * @param {object} opts
 * @param {object} opts.system            the particle pool
 * @param {{x:number,y:number}[]} opts.points  from `samplePoints`, glyph-relative
 * @param {number} opts.x                 glyph centre on screen, CSS px
 * @param {number} opts.y
 * @param {number} [opts.originX]         burst origin; defaults to the centre
 * @param {number} [opts.originY]
 * @param {string[]} [opts.colors]        palette keys, cycled across the cloud
 * @param {number} [opts.group]           word id; auto-allocated if omitted
 * @param {number} [opts.speedMin=110]    outward birth speed, CSS px/s
 * @param {number} [opts.speedMax=340]
 * @param {number} [opts.stagger=0.18]    extra delay across the radial range
 * @param {number} [opts.spread=0.55]     birth angle jitter, radians
 * @param {number} [opts.density]         the grid step the cloud was sampled at;
 *                                        sets `sizeScale` automatically
 * @param {number} [opts.sizeScale]       explicit override for the above
 * @returns {{ group: number, spawned: number, requested: number }}
 */
export function emitTextResolve(opts) {
  const system = opts && opts.system;
  const points = opts && opts.points;
  if (!system || !points || points.length === 0) {
    return { group: 0, spawned: 0, requested: 0 };
  }

  const group = opts.group === undefined ? nextTextGroup() : opts.group;
  const cx = opts.x || 0;
  const cy = opts.y || 0;
  const ox = opts.originX === undefined ? cx : opts.originX;
  const oy = opts.originY === undefined ? cy : opts.originY;
  const speedMin = opts.speedMin === undefined ? 110 : opts.speedMin;
  const speedMax = opts.speedMax === undefined ? 340 : opts.speedMax;
  const stagger = opts.stagger === undefined ? 0.18 : opts.stagger;
  const spread = opts.spread === undefined ? 0.55 : opts.spread;
  // Spark radius has to track the grid step, or the two fight each other. Too
  // large relative to the spacing and neighbouring dots merge, filling the
  // counters of a, e and o until a word is a smear; too small and the strokes
  // break up. Holding radius proportional to spacing keeps that ratio constant
  // at every font size. 4.4 is the divisor that reproduces the plan's 1.6/2.6
  // radii at the grid step SURPRISE samples at.
  const sizeScale =
    opts.sizeScale !== undefined
      ? opts.sizeScale
      : opts.density
        ? clamp(opts.density / 4.4, 0.6, 1.6)
        : 1;
  const rng = system.rng;

  const colors = opts.colors && opts.colors.length ? opts.colors : ['goldHi', 'whiteSpark'];
  const colorIdx = [];
  for (let i = 0; i < colors.length; i++) colorIdx.push(colorIndexOf(colors[i]));

  const n = points.length;
  const last = n > 1 ? n - 1 : 1;
  let spawned = 0;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const targetX = cx + p.x;
    const targetY = cy + p.y;

    // Radial fraction: 0 at the glyph centre, 1 at the outermost point.
    const f = i / last;

    // Outward velocity, aimed roughly at where this spark belongs so the flight
    // reads as purposeful, with enough angular jitter that it is clearly a
    // burst and not a set of rails.
    const aim = Math.atan2(targetY - oy, targetX - ox) + rng.jitter(spread);
    const speed = speedMin + rng.next() * (speedMax - speedMin);

    const duration =
      RESOLVE_MIN_SECONDS + (RESOLVE_MAX_SECONDS - RESOLVE_MIN_SECONDS) * f;

    // Two alternating sizes give the strokes their fine dotted, ember-built
    // texture rather than a uniform dotted line.
    const size = (i & 1 ? LETTER_SIZE_B : LETTER_SIZE_A) * sizeScale;

    const idx = system.spawnLetter(
      ox,
      oy,
      Math.cos(aim) * speed,
      Math.sin(aim) * speed * 0.82,
      targetX,
      targetY,
      f * stagger,
      duration,
      size,
      colorIdx[i % colorIdx.length],
      group
    );
    if (idx >= 0) spawned++;
  }

  return { group, spawned, requested: n };
}

/**
 * Release an assembled word: gravity is restored and it drifts down and fades
 * over ~0.6 s.
 *
 * @param {object} system
 * @param {number} group
 * @returns {number} sparks released
 */
export function disperseText(system, group) {
  if (!system) return 0;
  return system.disperseGroup(group);
}

/** True once every spark of `group` has landed — the word is fully legible. */
export function isTextResolved(system, group) {
  return !!system && system.groupResolved(group);
}

// --- Line layout (plan 6.5) ---------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Greedy word packing at a given size, using proportional widths measured once
 * at `MEASURE_REF`. Returns row start/end indices and row widths.
 */
function packRows(refWidths, refSpace, size, maxRowWidth, out) {
  const k = size / MEASURE_REF;
  const space = refSpace * k;
  out.length = 0;
  let start = 0;
  let width = 0;
  for (let i = 0; i < refWidths.length; i++) {
    const w = refWidths[i] * k;
    const next = i === start ? w : width + space + w;
    if (i !== start && next > maxRowWidth) {
      out.push(start, i, width);
      start = i;
      width = w;
    } else {
      width = next;
    }
  }
  out.push(start, refWidths.length, width);
  return out.length / 3;
}

/**
 * Lay a line of words out as fireworks at varying altitudes.
 *
 * Packs the words into rows that fit `viewport.width * 0.88`, chooses the
 * largest font size in the plan's `clamp(18px, 4.6vw, 46px)` family that still
 * fits within `maxRows` rows, then jitters each word's vertical offset by
 * +/-6% of viewport height so the result reads as separate shells rather than a
 * typeset line.
 *
 * On a narrow viewport the size search deliberately reaches ABOVE the raw
 * `4.6vw` value (which is only 14.7 px at 320 px, below the 18 px floor) up to
 * `width / 9`. That is what turns a 12-word line into the 3-4 phone rows the
 * plan asks for, and it is the reason the phone text is readable at arm's
 * length rather than technically-present-but-tiny.
 *
 * GUARANTEE: every returned word satisfies `0 <= x - width/2` and
 * `x + width/2 <= viewport.width`, at any viewport down to 320 px. Two
 * mechanisms enforce it — the size is scaled until the widest row fits the 88%
 * budget, and each word is finally clamped into the viewport regardless.
 *
 * @param {string|string[]} words
 * @param {{width:number, height:number}} viewport CSS px
 * @param {object} [options]
 * @param {boolean} [options.italic=true] the sentence lines are italic
 * @param {number} [options.centerY]      vertical centre of the block
 * @param {number} [options.maxRows=4]
 * @param {number} [options.minRows]      defaults to 2 for lines of 9+ words
 * @param {number} [options.seed]         jitter seed; defaults to the text
 * @returns {{ fontSize:number, italic:boolean, lineHeight:number,
 *             rowCount:number, maxRowWidth:number,
 *             rows: {index:number, y:number, width:number, words:object[]}[],
 *             words: {text:string, x:number, y:number, width:number,
 *                     row:number, index:number}[] }}
 *   `x`/`y` are the CENTRE of each word, which is where its sampled point cloud
 *   should be placed.
 */
export function layoutLine(words, viewport, options) {
  const o = options || {};
  const list = typeof words === 'string' ? words.split(/\s+/).filter(Boolean) : words.slice();
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  const italic = o.italic !== false;
  const maxRows = o.maxRows === undefined ? 4 : o.maxRows;
  const maxRowWidth = vw * ROW_WIDTH_FRACTION;

  const empty = {
    fontSize: FONT_MIN,
    italic,
    lineHeight: FONT_MIN * LINE_HEIGHT,
    rowCount: 0,
    maxRowWidth,
    rows: [],
    words: [],
  };
  if (list.length === 0) return empty;

  // Measure once at a reference size and scale. Canvas advance widths are
  // linear in font size, so this turns the size search from N*measure calls
  // into one pass, and the final exact re-measure below closes any drift.
  const mctx = getMeasureCtx();
  mctx.font = fontString(MEASURE_REF, italic);
  const refWidths = new Array(list.length);
  for (let i = 0; i < list.length; i++) refWidths[i] = mctx.measureText(list[i]).width;
  const refSpace = mctx.measureText(' ').width;

  // The plan's CSS clamp, plus the narrow-viewport headroom described above.
  const cssClamp = clamp(vw * FONT_VW, FONT_MIN, FONT_MAX);
  const sizeCap = Math.max(cssClamp, Math.min(FONT_MAX, vw / 9));

  // Row budget. Long lines get a tightened budget so they always break into at
  // least `minRows` rows; both terms scale linearly with font size, so the row
  // count this produces is size-independent and the search below stays stable.
  const minRows = o.minRows === undefined ? (list.length >= BALANCE_MIN_WORDS ? 2 : 1) : o.minRows;
  let refTotal = refSpace * (list.length - 1);
  for (let i = 0; i < refWidths.length; i++) refTotal += refWidths[i];
  const budgetFor = (size) => {
    const total = refTotal * (size / MEASURE_REF);
    const balanced = (total / minRows) * BALANCE_SLACK;
    return minRows > 1 && balanced < maxRowWidth ? balanced : maxRowWidth;
  };

  // Search downward for the largest size that packs within `maxRows`.
  const packing = [];
  let fontSize = sizeCap;
  let rowCount = packRows(refWidths, refSpace, fontSize, budgetFor(fontSize), packing);
  for (let step = 0; step < 40 && rowCount > maxRows && fontSize > FONT_MIN * 0.5; step++) {
    fontSize *= 0.94;
    rowCount = packRows(refWidths, refSpace, fontSize, budgetFor(fontSize), packing);
  }

  // Exact measurement at the chosen size, then a final corrective scale so the
  // widest row provably fits the budget. This is the clipping guarantee.
  mctx.font = fontString(fontSize, italic);
  const wordWidths = new Array(list.length);
  for (let i = 0; i < list.length; i++) wordWidths[i] = mctx.measureText(list[i]).width;
  const spaceWidth = mctx.measureText(' ').width;

  let widest = 0;
  for (let r = 0; r < rowCount; r++) {
    const from = packing[r * 3];
    const to = packing[r * 3 + 1];
    let w = 0;
    for (let i = from; i < to; i++) w += wordWidths[i] + (i > from ? spaceWidth : 0);
    if (w > widest) widest = w;
  }
  if (widest > maxRowWidth) {
    const correction = maxRowWidth / widest;
    fontSize *= correction;
    for (let i = 0; i < wordWidths.length; i++) wordWidths[i] *= correction;
    widest = maxRowWidth;
  }

  const lineHeight = fontSize * LINE_HEIGHT;
  const centerY = o.centerY === undefined ? vh * 0.46 : o.centerY;

  // Vertical safe band, so a jittered word can never leave the viewport.
  const half = fontSize * 0.6;
  const minY = vh * SAFE_TOP + half;
  const maxY = vh * SAFE_BOTTOM - half;

  const rng = createRng(
    hashString(o.seed === undefined ? `nikkah.layout|${list.join(' ')}` : String(o.seed))
  );
  // Plan 6.5 asks for +/-6% of viewport height, which is what a single-row line
  // gets. A multi-row line cannot have it: at 320x568 that is +/-34 px against
  // a 44 px row pitch, so rows interleave and words from different rows land on
  // top of each other — rendered and screenshotted, it is unreadable. Capping
  // the amplitude at 30% of the row pitch keeps the "shells at different
  // altitudes" read within a row while guaranteeing rows never collide.
  // 0.3 of the pitch still let an ascender reach the row above once the taller
  // 1.62 pitch was in place; 0.18 leaves roughly a full glyph height of clear
  // air between rows at every size that was screenshotted.
  const jitterAmount =
    rowCount > 1
      ? Math.min(vh * ALTITUDE_JITTER, lineHeight * 0.18)
      : vh * ALTITUDE_JITTER;

  const rows = [];
  const flat = [];
  let wordIndex = 0;

  for (let r = 0; r < rowCount; r++) {
    const from = packing[r * 3];
    const to = packing[r * 3 + 1];

    let rowWidth = 0;
    for (let i = from; i < to; i++) rowWidth += wordWidths[i] + (i > from ? spaceWidth : 0);

    const rowY = centerY + (r - (rowCount - 1) / 2) * lineHeight;
    let penX = (vw - rowWidth) / 2;

    const rowWords = [];
    for (let i = from; i < to; i++) {
      const w = wordWidths[i];
      let x = penX + w / 2;
      // Hard clipping guarantee, independent of the size maths above.
      if (x - w / 2 < 0) x = w / 2;
      if (x + w / 2 > vw) x = vw - w / 2;

      let y = rowY + rng.jitter(jitterAmount);
      if (y < minY) y = minY;
      if (y > maxY) y = maxY;

      const entry = { text: list[i], x, y, width: w, row: r, index: wordIndex++ };
      rowWords.push(entry);
      flat.push(entry);
      penX += w + spaceWidth;
    }

    rows.push({ index: r, y: rowY, width: rowWidth, words: rowWords });
  }

  return {
    fontSize,
    italic,
    lineHeight,
    rowCount,
    maxRowWidth,
    rows,
    words: flat,
  };
}

/**
 * Convenience for the director: lay a line out, then sample every word's point
 * cloud at the layout's font size. Returns the layout with a `points` array
 * attached to each word.
 *
 * A whole line is on screen at once (plan 2.3 holds it for 1.2 s before the
 * fade), so the budget that matters is the LINE's, not the word's. `pointBudget`
 * is therefore split across the words rather than applied to each of them —
 * without that, a 12-word line at desktop sizes asks for more sparks than the
 * 1400-particle mobile pool even exists.
 *
 * @param {string|string[]} words
 * @param {{width:number, height:number}} viewport
 * @param {object} [options] as `layoutLine`, plus:
 *   `density`      grid override
 *   `pointBudget`  total sparks for the whole line (default 1200 — the value the
 *                  320/375/768/1440 legibility screenshots were taken at; at
 *                  phone sizes the grid step limits the count well below it, so
 *                  it only binds on desktop, where the pool is 2600)
 *   `maxPoints`    hard per-word ceiling, overriding the split
 */
export function layoutAndSample(words, viewport, options) {
  const o = options || {};
  const layout = layoutLine(words, viewport, o);
  const n = layout.words.length || 1;
  const budget = o.pointBudget === undefined ? 1200 : o.pointBudget;
  const perWord =
    o.maxPoints === undefined ? clamp(Math.floor(budget / n), 40, 500) : o.maxPoints;
  for (let i = 0; i < layout.words.length; i++) {
    const w = layout.words[i];
    const info = samplePointsInfo(w.text, {
      fontSize: layout.fontSize,
      italic: layout.italic,
      density: o.density,
      maxPoints: perWord,
    });
    w.points = info.points;
    w.density = info.density;
    w.sampleFailed = info.failed;
    w.fontReady = info.fontReady;
  }
  return layout;
}

/** Constants the director and the harness need to agree on. */
export const TEXT_CONSTANTS = Object.freeze({
  ROW_WIDTH_FRACTION,
  FONT_MIN,
  FONT_MAX,
  FONT_VW,
  LINE_HEIGHT,
  ALTITUDE_JITTER,
  RESOLVE_MIN_SECONDS,
  RESOLVE_MAX_SECONDS,
  LETTER_SIZE_A,
  LETTER_SIZE_B,
  FONT_PROBE,
});
