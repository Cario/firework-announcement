/**
 * The 30-second schedule, as structured data.
 *
 * Nothing here schedules anything. This module only *describes* what happens
 * and when, in seconds since the tap. The director (Phase 7) walks this data
 * against the loop's accumulated `elapsed`, so a backgrounded tab resumes in
 * step instead of drifting the way a pile of `setTimeout`s would.
 *
 * Source table: docs/plans/01-implementation-plan.md § 2.3
 */

import { CONTENT_EN } from './content.js';

/* ------------------------------------------------------------------ *
 * Absolute beats
 * ------------------------------------------------------------------ */

/** Target total runtime, tap to card, in seconds. */
export const TARGET_RUNTIME = 30.0;

/** Accepted slack on the total, per the plan's Phase 7 assertion. */
export const RUNTIME_TOLERANCE = 0.5;

/**
 * Named times, in seconds from the tap. Transcribed one-for-one from the
 * plan's 2.3 table — this object is the contract, the arrays below are
 * derived from it.
 */
/**
 * How long the match takes to reach the fuse after the tap. The set-piece
 * animates the strike over this window, and the cord only catches at the end
 * of it — so this is also when the fuse audio starts.
 */
export const FUSE_CATCH = 0.42;

export const T = {
  TAP: 0.0,

  // Match travels to the cord, then the fuse burns toward the rocket base.
  FUSE_START: 0.0,
  FUSE_CATCH_AT: FUSE_CATCH,
  FUSE_END: 1.4,

  // Lift-off, launch whoosh, camera begins following.
  LIFTOFF: 1.4,
  CLIMB_END: 4.1,

  // Big burst at screen centre: boom + crackle.
  BIG_BURST: 4.1,

  // SURPRISE resolves out of the flares, holds, then fades.
  SURPRISE_RESOLVE_START: 4.3,
  SURPRISE_RESOLVE_END: 5.2,
  SURPRISE_HOLD_START: 5.2,
  SURPRISE_HOLD_END: 7.6,
  SURPRISE_FADE_START: 7.6,
  SURPRISE_FADE_END: 8.4,

  // The three invitation lines.
  LINE1_START: 8.6,
  LINE1_END: 13.6,
  LINE2_START: 13.9,
  LINE2_END: 19.6,
  LINE3_START: 19.9,
  LINE3_END: 25.6,

  // Date + location, two gold bursts.
  DATELINE_START: 25.9,
  DATELINE_END: 28.2,

  // Sky quietens; a few ambient distant bursts.
  SETTLE_START: 28.2,
  SETTLE_END: 29.2,

  // Invite card fades in over the sky; replay button appears.
  CARD_START: 29.0,
  CARD_END: 30.0,
};

/* ------------------------------------------------------------------ *
 * Per-line word choreography constants
 * ------------------------------------------------------------------ */

/** A word's shell rises for this long before it bursts into the word. */
export const SHELL_RISE = 0.35;

/**
 * Burst-to-fully-resolved time for one word. Phase 6.4 staggers individual
 * sparks over 0.55–0.95 s by radial index; 0.55 is when the *first* sparks
 * land and the word becomes readable, which is what the hold is measured from.
 */
export const WORD_RESOLVE = 0.55;

/** A completed line stays fully visible for at least this long. */
export const LINE_HOLD_MIN = 1.2;

/** …then fades over this long. */
export const LINE_FADE = 0.6;

/**
 * Colour cycle for consecutive words within a line (palette keys, not hex).
 * Phase 7 seeds the *starting* index per line so it is stable across replays.
 */
/**
 * Blue is deliberately absent. `blue` on the night sky is the lowest-contrast
 * pairing in the palette and those words were measurably the hardest to read;
 * it stays in the decorative bursts, where legibility is not the job. Gold and
 * white carry the text, with green as the only accent.
 */
export const WORD_COLOR_CYCLE = ['goldHi', 'whiteSpark', 'goldHi', 'green'];

/** SURPRISE is gold + white only. */
export const SURPRISE_COLORS = ['goldHi', 'whiteSpark'];

/** The date line is gold. */
export const DATELINE_COLORS = ['gold', 'goldHi'];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Split a line into its words. Punctuation stays attached to its word. */
export function wordsOf(line) {
  return line.trim().split(/\s+/);
}

/**
 * The plan's literal stagger rule: `lineDuration / (wordCount + 2)`.
 * The two extra slots are the tail the line needs to hold and fade in.
 */
export function staggerFor(lineDuration, wordCount) {
  return lineDuration / (wordCount + 2);
}

/**
 * Build the full word-by-word schedule for one line.
 *
 * Timing model, per word i (0-based):
 *   shell launches at  start + i * stagger
 *   bursts at          + SHELL_RISE
 *   is readable at     + WORD_RESOLVE
 * then the whole line holds and fades out by `end`.
 *
 * NOTE — a real conflict in the source plan, resolved here deliberately.
 * The nominal stagger `lineDuration / (wordCount + 2)` cannot coexist with
 * "holds fully visible >= 1.2 s then fades over 0.6 s" inside the table's
 * absolute windows. Line 2, for example: 5.7 s / (12 + 2) = 0.407 s, so the
 * last word alone bursts at +4.48 s and is readable at +5.38 s, leaving
 * 0.32 s of tail where 1.8 s is required.
 *
 * The absolute beats in the table are load-bearing (audio and camera hang off
 * them) and the legibility floor is the point of the whole exercise, so the
 * *stagger* is what gives: it is computed nominally, then compressed only as
 * far as needed to fit the hold and fade. `nominalStagger` is reported
 * alongside `stagger` so the compression is visible rather than silent.
 */
export function planLine({ text, start, end, colorOffset = 0, kindPrefix = 'word' }) {
  const words = wordsOf(text);
  const n = words.length;
  const duration = end - start;

  const nominalStagger = staggerFor(duration, n);

  // Time available for words to appear, before the mandatory tail.
  const appearBudget = duration - LINE_HOLD_MIN - LINE_FADE;
  // Time the appearance takes at the nominal stagger.
  const nominalSpan = (n - 1) * nominalStagger + SHELL_RISE + WORD_RESOLVE;

  const stagger =
    n <= 1 || nominalSpan <= appearBudget
      ? nominalStagger
      : Math.max(0, (appearBudget - SHELL_RISE - WORD_RESOLVE) / (n - 1));

  const events = [];
  const wordPlan = words.map((word, i) => {
    const shellAt = start + i * stagger;
    const burstAt = shellAt + SHELL_RISE;
    const readableAt = burstAt + WORD_RESOLVE;
    const color = WORD_COLOR_CYCLE[(i + colorOffset) % WORD_COLOR_CYCLE.length];

    events.push({
      t: shellAt,
      kind: `${kindPrefix}Shell`,
      payload: { word, index: i, color, duration: SHELL_RISE },
    });
    events.push({
      t: burstAt,
      kind: `${kindPrefix}Burst`,
      payload: { word, index: i, color, duration: WORD_RESOLVE },
    });

    // Every one of these is a firework and needs to sound like one. They had
    // no audio at all: only the opening burst and the date line were ever
    // scheduled, so three quarters of the show played out in silence.
    events.push({
      t: shellAt,
      kind: 'sound',
      payload: { name: 'shellWhistle', duration: SHELL_RISE, gain: 0.9 },
    });
    events.push({
      t: burstAt,
      kind: 'sound',
      payload: { name: 'smallPop', gain: 0.85 },
    });
    events.push({
      t: burstAt + 0.04,
      kind: 'sound',
      payload: { name: 'crackleLight', gain: 0.8 },
    });

    return { word, index: i, color, shellAt, burstAt, readableAt };
  });

  const readableAt = wordPlan.length ? wordPlan[wordPlan.length - 1].readableAt : start;
  const fadeAt = end - LINE_FADE;
  const hold = fadeAt - readableAt;

  events.push({
    t: fadeAt,
    kind: `${kindPrefix}LineFade`,
    payload: { duration: LINE_FADE },
  });

  return {
    text,
    words,
    wordCount: n,
    start,
    end,
    duration,
    nominalStagger,
    stagger,
    compressed: stagger < nominalStagger,
    readableAt,
    fadeAt,
    hold,
    events,
  };
}

/* ------------------------------------------------------------------ *
 * The lines
 * ------------------------------------------------------------------ */

/**
 * The three invitation lines with their windows.
 *
 * Word counts are derived from CONTENT, never hard-coded. The plan's table
 * labels line 3 as "11 words"; the actual string has 12
 * ("with Neha Kashif, the beloved daughter of Kashif Ali and Aisha Kashif").
 * CONTENT wins — it is the single source of truth.
 */
/**
 * Build the three invitation lines for one language.
 *
 * Word counts come from the content, never from a constant, so a language
 * whose lines are longer or shorter simply gets more or fewer fireworks. The
 * per-line time windows are fixed, and `planLine` compresses its own stagger
 * to fit them, so the total runtime stays 30 s in every language.
 */
export function buildLines(content) {
  return [
    planLine({ text: content.lines[0], start: T.LINE1_START, end: T.LINE1_END, colorOffset: 0, kindPrefix: 'line1' }),
    planLine({ text: content.lines[1], start: T.LINE2_START, end: T.LINE2_END, colorOffset: 1, kindPrefix: 'line2' }),
    planLine({ text: content.lines[2], start: T.LINE3_START, end: T.LINE3_END, colorOffset: 2, kindPrefix: 'line3' }),
  ];
}

/** English lines, for the modules that still import `LINES` directly. */
export const LINES = buildLines(CONTENT_EN);

/* ------------------------------------------------------------------ *
 * Phases — the director's state machine, as windows
 * ------------------------------------------------------------------ */

/**
 * `idle -> fuse -> launch -> surprise -> line1 -> line2 -> line3 ->
 *  dateline -> settle -> card`
 *
 * Windows may overlap (settle runs under the card fade); the director takes
 * the last phase whose `start` has passed.
 */
export const PHASES = [
  { name: 'fuse', start: T.FUSE_START, end: T.FUSE_END },
  { name: 'launch', start: T.LIFTOFF, end: T.BIG_BURST },
  { name: 'surprise', start: T.BIG_BURST, end: T.SURPRISE_FADE_END },
  { name: 'line1', start: T.LINE1_START, end: T.LINE1_END },
  { name: 'line2', start: T.LINE2_START, end: T.LINE2_END },
  { name: 'line3', start: T.LINE3_START, end: T.LINE3_END },
  { name: 'dateline', start: T.DATELINE_START, end: T.DATELINE_END },
  { name: 'settle', start: T.SETTLE_START, end: T.SETTLE_END },
  { name: 'card', start: T.CARD_START, end: T.CARD_END },
];

/** The phase active at time `t`, or `'idle'` before the tap. */
export function phaseAt(t) {
  if (t < 0) return 'idle';
  let current = 'idle';
  for (const phase of PHASES) {
    if (t >= phase.start) current = phase.name;
  }
  return current;
}

/* ------------------------------------------------------------------ *
 * The schedule
 * ------------------------------------------------------------------ */

/**
 * Every scheduled beat as `{ t, kind, payload }`, sorted by time.
 *
 * `payload.duration` (where present) is how long the beat itself runs, and is
 * what `scheduleEnd()` sums against to find the true end of the piece.
 */
export function buildSchedule(content) {
  const lines = buildLines(content);
  return [
  // --- Fuse -----------------------------------------------------------
  {
    t: T.FUSE_START,
    kind: 'fuseIgnite',
    payload: { duration: T.FUSE_END - T.FUSE_START, catchAt: FUSE_CATCH },
  },
  // Not on the tap — on contact. The match has to travel to the cord first,
  // and the sound belongs to the moment it arrives. It ends at lift-off; the
  // travel whistle carries the flight from there.
  {
    t: T.FUSE_CATCH_AT,
    kind: 'sound',
    payload: { name: 'fuse', duration: T.FUSE_END - T.FUSE_CATCH_AT },
  },

  // --- Launch ---------------------------------------------------------
  { t: T.LIFTOFF, kind: 'liftoff', payload: { duration: T.CLIMB_END - T.LIFTOFF } },
  { t: T.LIFTOFF, kind: 'sound', payload: { name: 'launch' } },
  { t: T.LIFTOFF, kind: 'sound', payload: { name: 'ambient' } },
  // The launch thump only covers 1.2 s of a 2.7 s climb; the whistle carries
  // the shell the rest of the way up, and the wind sits under the camera rise.
  {
    t: T.LIFTOFF + 0.32,
    kind: 'sound',
    payload: { name: 'travel', duration: T.BIG_BURST - T.LIFTOFF - 0.32 },
  },
  {
    t: T.LIFTOFF,
    kind: 'sound',
    payload: { name: 'wind', duration: T.BIG_BURST - T.LIFTOFF + 0.6 },
  },
  { t: T.LIFTOFF, kind: 'cameraFollow', payload: { duration: T.CLIMB_END - T.LIFTOFF } },

  // --- The big burst --------------------------------------------------
  {
    t: T.BIG_BURST,
    kind: 'bigBurst',
    payload: { colors: SURPRISE_COLORS, countScale: 2.2, duration: 0.2 },
  },
  { t: T.BIG_BURST, kind: 'sound', payload: { name: 'boom' } },
  { t: T.BIG_BURST, kind: 'sound', payload: { name: 'crackle' } },

  // --- SURPRISE -------------------------------------------------------
  {
    t: T.SURPRISE_RESOLVE_START,
    kind: 'surpriseResolve',
    payload: {
      text: content.surprise,
      colors: SURPRISE_COLORS,
      duration: T.SURPRISE_RESOLVE_END - T.SURPRISE_RESOLVE_START,
    },
  },
  {
    t: T.SURPRISE_HOLD_START,
    kind: 'surpriseHold',
    payload: { duration: T.SURPRISE_HOLD_END - T.SURPRISE_HOLD_START },
  },
  // Two small flanking bursts inside the hold.
  { t: 5.6, kind: 'flankBurst', payload: { side: -1, color: 'green' } },
  { t: 5.6, kind: 'sound', payload: { name: 'smallPop' } },
  { t: 6.5, kind: 'flankBurst', payload: { side: 1, color: 'blue' } },
  { t: 6.5, kind: 'sound', payload: { name: 'smallPop' } },
  {
    t: T.SURPRISE_FADE_START,
    kind: 'surpriseFade',
    payload: { duration: T.SURPRISE_FADE_END - T.SURPRISE_FADE_START },
  },

  // --- The three lines (expanded from LINES below) ---------------------

  // --- Date + location -------------------------------------------------
  {
    t: T.DATELINE_START,
    kind: 'datelineResolve',
    payload: {
      lines: [content.dateLine, content.locationLine],
      colors: DATELINE_COLORS,
      duration: T.DATELINE_END - T.DATELINE_START,
    },
  },
  { t: T.DATELINE_START, kind: 'sound', payload: { name: 'smallPop' } },
  { t: T.DATELINE_START + 0.45, kind: 'sound', payload: { name: 'smallPop' } },
  { t: T.DATELINE_START + 0.9, kind: 'sound', payload: { name: 'shimmer' } },

  // --- Settle ----------------------------------------------------------
  {
    t: T.SETTLE_START,
    kind: 'settle',
    payload: { ambientBursts: 3, duration: T.SETTLE_END - T.SETTLE_START },
  },

  // --- Card ------------------------------------------------------------
  {
    t: T.CARD_START,
    kind: 'card',
    payload: { duration: T.CARD_END - T.CARD_START },
  },
]
  .concat(lines.flatMap((line) => line.events))
  .sort((a, b) => a.t - b.t);
}

/**
 * Everything the director needs for one language, bound to that language's
 * schedule. Call once per language; the director holds the result.
 *
 * @param {object} content one of the objects from `config/content.js`
 */
export function createTimeline(content) {
  const schedule = buildSchedule(content);
  const lines = buildLines(content);

  /** The latest moment anything is still running. */
  function scheduleEndOf() {
    let end = 0;
    for (const event of schedule) {
      const duration =
        event.payload && typeof event.payload.duration === 'number' ? event.payload.duration : 0;
      const finish = event.t + duration;
      if (finish > end) end = finish;
    }
    return end;
  }

  return {
    content,
    schedule,
    lines,
    scheduleEnd: scheduleEndOf,

    /**
     * Every event in `[from, to)`, in order. The director calls this each
     * frame with the window the loop just advanced through, so nothing is
     * missed on a long frame and nothing fires twice.
     */
    eventsBetween(from, to) {
      return schedule.filter((event) => event.t >= from && event.t < to);
    },

    /**
     * `{ ok, total, target, tolerance }`. Pure — returns a result rather than
     * throwing, so the caller decides what a failure means. Both languages
     * must land inside the tolerance despite differing word counts.
     */
    checkRuntime(tolerance = RUNTIME_TOLERANCE) {
      const total = scheduleEndOf();
      return {
        ok: Math.abs(total - TARGET_RUNTIME) <= tolerance,
        total,
        target: TARGET_RUNTIME,
        tolerance,
      };
    },
  };
}
