/**
 * The director — the state machine that runs the whole show.
 *
 * It owns nothing visual. The scene, the particle pool, the audio and the card
 * are all built elsewhere and handed in; this module only decides WHAT happens
 * WHEN, by walking `config/timeline.js` and dispatching its events.
 *
 * Time comes from the render loop's accumulated `dt`, never from wall-clock or
 * `setTimeout`. The loop already pauses itself while the tab is hidden, so a
 * viewer who switches away mid-flight comes back to the beat they left on
 * rather than to a sequence that ran on without them.
 *
 * Coordinate spaces (the one thing worth holding in your head here):
 *   - the SCENE draws in world space, through the camera
 *   - PARTICLES draw in screen space, untransformed
 * The rocket bridges the two: its position is simulated in world space so the
 * camera can follow it, then converted to screen space to emit its trail and
 * to place every burst. `toScreenY` is the only conversion, and everything
 * downstream of it is screen space.
 */

import {
  T,
  PHASES,
  eventsBetween,
  scheduleEnd,
  checkRuntime,
  SURPRISE_COLORS,
  DATELINE_COLORS,
} from '../config/timeline.js';
import { CONTENT } from '../config/content.js';
import { easeInCubic, clamp01 } from '../engine/easing.js';
import { emitBurst, emitShell, setBurstSystem } from '../fx/burst.js';
import {
  ensureFontsReady,
  samplePointsInfo,
  emitTextResolve,
  disperseText,
  layoutLine,
  invalidatePointCache,
  nextTextGroup,
} from '../fx/textPoints.js';

/**
 * Solid-glyph overlay timing, relative to the word's burst.
 *
 * The embers form the shape first; the real letter then fades up through them.
 * The delay is set just past the point where the first sparks land, so the
 * word is recognisably itself before it firms up.
 */
const GLYPH_DELAY = 0.42;
const GLYPH_FADE_IN = 0.5;
const GLYPH_FADE_OUT = 0.5;

/** Where the rocket bursts, as a fraction of the viewport height. */
const APEX_VIEW_RATIO = 0.4;

/**
 * How long the opening crop takes to pull back to the whole scene once the
 * rocket is away. Slightly longer than the initial acceleration, so the frame
 * is still widening while the rocket is picking up speed.
 */
const ZOOM_OUT_SECONDS = 1.0;

/**
 * How long the camera stays put after lift-off before it starts climbing.
 *
 * Without this the crop pulls back and the camera pans up at the same time, so
 * the wide meadow — treeline and all — exists for a fraction of a second
 * between the two moves. Holding the camera still lets the rocket rise through
 * a settled frame first, which is also the more natural way to watch something
 * leave the ground.
 */
const FOLLOW_DELAY = 0.55;

/**
 * Fraction of the climb spent in the initial acceleration. Plan 5.3 asks for
 * `easeInCubic` over the first 0.35 s of a 2.7 s climb.
 */
const ACCEL_FRACTION = 0.35 / (T.CLIMB_END - T.LIFTOFF);

/** How much of the total distance is covered during that acceleration. */
const ACCEL_DISTANCE = 0.06;

/** Horizontal wander of the climbing rocket, CSS px at scale 1. Plan 5.3. */
const DRIFT_AMPLITUDE = 14;

/** Sparks in the cluster riding the fuse burn head. Plan 5.2: 6-10. */
const FUSE_EMBER_MIN = 6;
const FUSE_EMBER_MAX = 10;

/** Seconds between fuse ember puffs. */
const FUSE_EMBER_INTERVAL = 0.055;

/* ------------------------------------------------------------------ *
 * Reduced motion
 * ------------------------------------------------------------------ */

/** Fade-in, hold and fade-out for one line of the calm sequence. */
const CALM_FADE_IN = 1.1;
const CALM_HOLD = 1.5;
const CALM_FADE_OUT = 0.7;
const CALM_STEP = CALM_FADE_IN + CALM_HOLD + CALM_FADE_OUT;

/** True when the viewer has asked their system for less animation. */
function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Build the director.
 *
 * @param {object} deps
 * @param {{ width: number, height: number }} deps.view       live canvas size
 * @param {object} deps.camera
 * @param {object} deps.metrics    from `createWorldMetrics`
 * @param {object} deps.setpiece
 * @param {object} deps.particles  the pool
 * @param {object} deps.trail      from `createTrail`
 * @param {object} deps.sound      the audio module namespace
 * @param {object|null} deps.prompt
 * @param {() => void} [deps.onFinished]  fired once, when the card should show
 * @returns {object} the director
 */
export function createDirector(deps) {
  const { camera, particles, trail, sound } = deps;

  let view = deps.view;
  let metrics = deps.metrics;
  let setpiece = deps.setpiece;
  const prompt = deps.prompt || null;
  const onFinished = deps.onFinished || (() => {});

  setBurstSystem(particles);

  /** 'idle' | 'running' | 'finished' */
  let state = 'idle';
  let phase = 'idle';
  let t = 0;
  let finishedFired = false;
  let failed = false;

  // Flight state, world space.
  let flying = false;
  let launchX = 0;
  let launchY = 0;
  let apexY = 0;
  let rocketWorldX = 0;
  let rocketWorldY = 0;
  let rocketVelY = 0;
  let rocketScale = 1;
  let stickLength = 0;

  let fuseEmberClock = 0;

  // Reduced-motion path: the same words, delivered calmly.
  const reduced = prefersReducedMotion();
  const calmLines = [
    { text: CONTENT.surprise, size: 0.09, italic: false },
    { text: CONTENT.lines[0], size: 0.052, italic: true },
    { text: CONTENT.lines[1], size: 0.046, italic: true },
    { text: CONTENT.lines[2], size: 0.046, italic: true },
    { text: `${CONTENT.dateLine} — ${CONTENT.locationLine}`, size: 0.044, italic: false },
  ];
  let calmIndex = 0;
  let calmAlpha = 0;

  /**
   * Solid letters riding on top of the ember clouds. Each entry carries the
   * exact metrics the sampler used, so the glyph sits precisely on its sparks.
   */
  let glyphs = [];

  function addGlyph(entry) {
    glyphs.push({
      text: entry.text,
      x: entry.x,
      y: entry.y,
      fontSize: entry.fontSize,
      italic: !!entry.italic,
      letterSpacing: entry.letterSpacing || 0,
      width: entry.width,
      color: entry.color,
      bornAt: t,
      fadeAt: null,
    });
  }

  /** Start the fade-out of every glyph belonging to a finished line. */
  function fadeGlyphs(predicate) {
    for (const g of glyphs) {
      if (g.fadeAt === null && predicate(g)) g.fadeAt = t;
    }
  }

  // Text groups, so each line can be dispersed as a unit.
  let surpriseGroups = [];
  const lineGroups = { line1: [], line2: [], line3: [], dateline: [] };
  const lineLayouts = { line1: null, line2: null, line3: null };

  /** World y -> screen y. The camera is the only thing between them. */
  function toScreenY(worldY) {
    return worldY - camera.y;
  }

  /** The rocket's current screen position. */
  function rocketScreen() {
    return { x: rocketWorldX, y: toScreenY(rocketWorldY) };
  }

  /** Where the show's bursts happen once the rocket is gone. */
  function apexScreen() {
    return { x: view.width / 2, y: view.height * APEX_VIEW_RATIO };
  }

  /* ------------------------------------------------------------------ *
   * Flight
   * ------------------------------------------------------------------ */

  function beginFlight() {
    const base = setpiece.rocketBaseWorld;
    launchX = base.x;
    launchY = base.y;
    rocketScale = base.scale;
    stickLength = base.stickLength;
    apexY = view.height * APEX_VIEW_RATIO;

    rocketWorldX = launchX;
    rocketWorldY = launchY;
    rocketVelY = 0;

    setpiece.setRocketVisible(false);
    flying = true;
  }

  /**
   * Climb profile: `easeInCubic` off the pad, then near-linear. Returns the
   * fraction of the total distance covered at flight progress `p`.
   */
  function climbEase(p) {
    if (p <= ACCEL_FRACTION) {
      return easeInCubic(p / ACCEL_FRACTION) * ACCEL_DISTANCE;
    }
    const rest = (p - ACCEL_FRACTION) / (1 - ACCEL_FRACTION);
    return ACCEL_DISTANCE + rest * (1 - ACCEL_DISTANCE);
  }

  function updateFlight(dt) {
    const p = clamp01((t - T.LIFTOFF) / (T.CLIMB_END - T.LIFTOFF));
    const previousY = rocketWorldY;

    rocketWorldY = launchY + (apexY - launchY) * climbEase(p);
    rocketWorldX = launchX + Math.sin(p * Math.PI * 2.2) * DRIFT_AMPLITUDE * rocketScale;

    // Finite difference rather than an analytic derivative: the profile is
    // piecewise, and the camera only needs the velocity to lead its spring.
    rocketVelY = dt > 0 ? (rocketWorldY - previousY) / dt : 0;

    // The rocket rises through a still frame first; the camera picks it up
    // once the crop has finished opening out.
    if (t >= T.LIFTOFF + FOLLOW_DELAY) {
      camera.follow(rocketWorldY, dt, rocketVelY);
    }

    const screen = rocketScreen();
    trail.emit(dt, screen.x, screen.y + stickLength * rocketScale, 0, rocketVelY, rocketScale);
  }

  /* ------------------------------------------------------------------ *
   * Text
   * ------------------------------------------------------------------ */

  /**
   * Lay out and sample a line once, then reuse it until the viewport changes.
   *
   * Dots are allocated in PROPORTION to each word's width rather than split
   * evenly. An even split is what makes a long line unreadable: "of" and
   * "Muhammad" get the same budget, which is generous for the former and
   * nowhere near enough for the latter. Widths come straight from the layout,
   * so the ink-per-pixel density is even across the whole line instead.
   */
  function layoutFor(key, text, centerRatio) {
    if (lineLayouts[key]) return lineLayouts[key];

    const layout = layoutLine(text, view, {
      italic: true,
      centerY: view.height * centerRatio,
    });

    const budget = Math.floor(particles.max * 0.62);
    let totalWidth = 0;
    for (const word of layout.words) totalWidth += word.width;

    for (const word of layout.words) {
      const share = totalWidth > 0 ? word.width / totalWidth : 1 / layout.words.length;
      const maxPoints = Math.max(90, Math.min(440, Math.floor(budget * share)));
      const info = samplePointsInfo(word.text, {
        fontSize: layout.fontSize,
        italic: layout.italic,
        maxPoints,
      });
      word.points = info.points;
      word.density = info.density;
      // Kept so the solid glyph can be drawn on exactly these metrics.
      word.sampleFontSize = info.fontSize;
      word.letterSpacing = info.letterSpacing;
      word.sampleWidth = info.width;
    }

    lineLayouts[key] = layout;
    return layout;
  }

  function resolveWord(key, layout, index, colorName) {
    const word = layout.words[index];
    if (!word || !word.points || word.points.length === 0) return;

    const group = nextTextGroup();
    emitBurst({
      x: word.x,
      y: word.y,
      count: 26,
      colors: [colorName, 'whiteSpark'],
      speedMin: 70,
      speedMax: 190,
      size: 2.2,
      life: 0.9,
    });
    emitTextResolve({
      system: particles,
      points: word.points,
      x: word.x,
      y: word.y,
      colors: [colorName],
      group,
      density: word.density,
    });
    lineGroups[key].push(group);

    addGlyph({
      text: word.text,
      x: word.x,
      y: word.y,
      fontSize: word.sampleFontSize,
      italic: layout.italic,
      letterSpacing: word.letterSpacing,
      width: word.sampleWidth,
      color: colorName,
      line: key,
    });
    glyphs[glyphs.length - 1].line = key;
  }

  function shellFor(key, layout, index) {
    const word = layout.words[index];
    if (!word) return;
    emitShell({
      x: word.x,
      y: view.height + 12,
      vy: -(view.height + 12 - word.y) / 0.35,
      count: 7,
      color: 'gold',
      life: 0.35,
    });
  }

  function disperseLine(key) {
    for (const group of lineGroups[key]) disperseText(particles, group);
    lineGroups[key] = [];
    fadeGlyphs((g) => g.line === key);
  }

  /* ------------------------------------------------------------------ *
   * Event dispatch
   * ------------------------------------------------------------------ */

  function handle(event) {
    const { kind, payload } = event;

    if (kind === 'sound') {
      // Pass the payload through: the sustained beds (fuse, travel, wind,
      // ambient) take their length from it.
      sound.play(payload.name, payload);
      return;
    }

    switch (kind) {
      case 'fuseIgnite':
        setpiece.startFuseBurn(payload.duration);
        break;

      case 'liftoff':
        beginFlight();
        break;

      case 'cameraFollow':
        break;

      case 'bigBurst': {
        flying = false;
        const at = rocketScreen();
        emitBurst({
          x: at.x,
          y: at.y,
          count: Math.round(90 * payload.countScale),
          colors: payload.colors,
          speedMin: 120,
          speedMax: 380,
          size: 3.2,
          life: 1.5,
          secondary: true,
        });
        emitBurst({
          x: at.x,
          y: at.y,
          count: 34,
          colors: ['whiteSpark'],
          speedMin: 60,
          speedMax: 150,
          size: 2.4,
          life: 1.1,
        });
        break;
      }

      case 'surpriseResolve': {
        const at = apexScreen();
        const size = Math.min(96, view.width / 7);
        const info = samplePointsInfo(payload.text, {
          fontSize: size,
          italic: false,
          letterSpacing: size * 0.12,
          maxWidth: view.width * 0.84,
          maxPoints: Math.min(760, Math.floor(particles.max * 0.34)),
        });
        const group = nextTextGroup();
        emitTextResolve({
          system: particles,
          points: info.points,
          x: at.x,
          y: at.y,
          colors: payload.colors || SURPRISE_COLORS,
          group,
          density: info.density,
          speedMin: 140,
          speedMax: 420,
        });
        surpriseGroups.push(group);

        addGlyph({
          text: payload.text,
          x: at.x,
          y: at.y,
          fontSize: info.fontSize,
          italic: false,
          letterSpacing: info.letterSpacing,
          width: info.width,
          color: 'goldHi',
        });
        glyphs[glyphs.length - 1].line = 'surprise';
        break;
      }

      case 'flankBurst': {
        const at = apexScreen();
        emitBurst({
          x: at.x + payload.side * view.width * 0.28,
          y: at.y + view.height * 0.12,
          count: 20,
          colors: [payload.color],
          speedMin: 50,
          speedMax: 150,
          size: 2.4,
          life: 1.0,
        });
        break;
      }

      case 'surpriseFade':
        for (const group of surpriseGroups) disperseText(particles, group);
        surpriseGroups = [];
        fadeGlyphs((g) => g.line === 'surprise');
        break;

      case 'line1Shell':
        shellFor('line1', layoutFor('line1', CONTENT.lines[0], 0.42), payload.index);
        break;
      case 'line2Shell':
        shellFor('line2', layoutFor('line2', CONTENT.lines[1], 0.44), payload.index);
        break;
      case 'line3Shell':
        shellFor('line3', layoutFor('line3', CONTENT.lines[2], 0.44), payload.index);
        break;

      case 'line1Burst':
        resolveWord('line1', layoutFor('line1', CONTENT.lines[0], 0.42), payload.index, payload.color);
        break;
      case 'line2Burst':
        resolveWord('line2', layoutFor('line2', CONTENT.lines[1], 0.44), payload.index, payload.color);
        break;
      case 'line3Burst':
        resolveWord('line3', layoutFor('line3', CONTENT.lines[2], 0.44), payload.index, payload.color);
        break;

      case 'line1LineFade':
        disperseLine('line1');
        break;
      case 'line2LineFade':
        disperseLine('line2');
        break;
      case 'line3LineFade':
        disperseLine('line3');
        break;

      case 'datelineResolve': {
        const colors = payload.colors || DATELINE_COLORS;
        const size = Math.min(54, Math.max(20, view.width / 15));
        // The two lines sit a fixed distance apart, derived from the type size,
        // rather than at fixed fractions of the viewport — nothing goes between
        // them, so a percentage-based gap just opens a hole on a tall screen.
        const gap = size * 1.5;
        const block = view.height * 0.44;
        payload.lines.forEach((text, row) => {
          const info = samplePointsInfo(text, {
            fontSize: row === 0 ? size : size * 0.72,
            italic: false,
            maxWidth: view.width * 0.84,
            maxPoints: Math.min(460, Math.floor(particles.max * 0.22)),
          });
          const y = row === 0 ? block : block + gap;
          const group = nextTextGroup();
          emitTextResolve({
            system: particles,
            points: info.points,
            x: view.width / 2,
            y,
            colors: [colors[row % colors.length]],
            group,
            density: info.density,
          });
          lineGroups.dateline.push(group);

          addGlyph({
            text,
            x: view.width / 2,
            y,
            fontSize: info.fontSize,
            italic: false,
            letterSpacing: info.letterSpacing,
            width: info.width,
            color: colors[row % colors.length],
          });
          glyphs[glyphs.length - 1].line = 'dateline';
        });
        break;
      }

      case 'settle': {
        const rng = particles.rng;
        for (let i = 0; i < payload.ambientBursts; i += 1) {
          emitBurst({
            x: view.width * rng.range(0.12, 0.88),
            y: view.height * rng.range(0.12, 0.5),
            count: 14,
            colors: ['whiteSpark', 'gold'],
            speedMin: 26,
            speedMax: 82,
            size: 1.7,
            life: 1.2,
          });
        }
        break;
      }

      case 'card':
        finish();
        break;

      default:
        break;
    }
  }

  function finish() {
    if (finishedFired) return;
    finishedFired = true;
    state = 'finished';
    for (const group of lineGroups.dateline) disperseText(particles, group);
    lineGroups.dateline = [];
    onFinished();
  }

  /* ------------------------------------------------------------------ *
   * Frame
   * ------------------------------------------------------------------ */

  /**
   * The reduced-motion sequence: no flight, no bursts, no camera move. Each
   * line simply fades up, holds long enough to read, and fades away, then the
   * card arrives. Same words, same order, none of the motion.
   */
  function calmStep(dt) {
    t += dt;

    const index = Math.floor(t / CALM_STEP);
    if (index >= calmLines.length) {
      calmAlpha = 0;
      if (!finishedFired) finish();
      return;
    }

    calmIndex = index;
    const local = t - index * CALM_STEP;
    if (local < CALM_FADE_IN) calmAlpha = local / CALM_FADE_IN;
    else if (local < CALM_FADE_IN + CALM_HOLD) calmAlpha = 1;
    else calmAlpha = clamp01(1 - (local - CALM_FADE_IN - CALM_HOLD) / CALM_FADE_OUT);

    phase = 'calm';
  }

  function step(dt) {
    if (reduced) {
      calmStep(dt);
      return;
    }

    const from = t;
    t += dt;

    for (const event of eventsBetween(from, t)) handle(event);

    // Only once the match has actually reached the fuse and it has caught —
    // during the strike the cord is still cold.
    if (t < T.FUSE_END && setpiece.state === 'burning') {
      fuseEmberClock += dt;
      if (fuseEmberClock >= FUSE_EMBER_INTERVAL) {
        fuseEmberClock = 0;
        const head = setpiece.burnHeadWorld;
        if (head) {
          const rng = particles.rng;
          const count =
            FUSE_EMBER_MIN + ((rng.next() * (FUSE_EMBER_MAX - FUSE_EMBER_MIN + 1)) | 0);
          emitBurst({
            x: head.x,
            y: toScreenY(head.y),
            count,
            colors: ['goldHi', 'flame'],
            speedMin: 8,
            speedMax: 42,
            size: 1.5,
            life: 0.45,
          });
        }
      }
    }

    if (flying) updateFlight(dt);

    phase = phaseAt(t);

    // The sequence can outrun the schedule's last event if a frame straddles
    // it; make sure the card still arrives.
    if (!finishedFired && t >= scheduleEnd()) finish();
  }

  function phaseAt(time) {
    let current = 'idle';
    for (const p of PHASES) if (time >= p.start) current = p.name;
    return current;
  }

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  const director = {
    get state() {
      return state;
    },
    get phase() {
      return phase;
    },
    get elapsed() {
      return t;
    },
    get flying() {
      return flying;
    },
    get failed() {
      return failed;
    },

    /** True when the viewer asked for less motion, so the renderer draws text. */
    get reducedMotion() {
      return reduced;
    },

    /**
     * How far the frame has opened out, 0 to 1.
     *
     * 0 is the opening crop, crammed in tight on the firework so it reads as
     * the subject rather than as a detail of a wide landscape; 1 is the whole
     * scene. It pulls back once the rocket is away. A viewer who asked for
     * reduced motion gets the wide framing from the start — a moving camera is
     * exactly what they opted out of.
     */
    get openness() {
      if (reduced) return 1;
      if (state === 'idle') return 0;
      if (state === 'finished') return 1;
      return clamp01((t - T.LIFTOFF) / ZOOM_OUT_SECONDS);
    },

    /**
     * The line the calm sequence is currently showing, or null. `size` is a
     * fraction of the viewport width so the renderer can pick a font size.
     */
    get calmLine() {
      if (!reduced || state !== 'running' || calmAlpha <= 0.001) return null;
      const line = calmLines[calmIndex];
      if (!line) return null;
      return { text: line.text, italic: line.italic, size: line.size, alpha: calmAlpha };
    },

    /**
     * Solid letters to paint over the ember clouds, with their current alpha.
     * Entries that have finished fading out are dropped as they are read.
     */
    get glyphList() {
      const out = [];
      let write = 0;
      for (let i = 0; i < glyphs.length; i += 1) {
        const g = glyphs[i];
        let alpha;
        if (g.fadeAt === null) {
          alpha = clamp01((t - g.bornAt - GLYPH_DELAY) / GLYPH_FADE_IN);
        } else {
          alpha =
            clamp01((t - g.bornAt - GLYPH_DELAY) / GLYPH_FADE_IN) *
            clamp01(1 - (t - g.fadeAt) / GLYPH_FADE_OUT);
          if (alpha <= 0.001) continue; // finished; drop it
        }
        glyphs[write++] = g;
        if (alpha > 0.001) out.push({ g, alpha });
      }
      glyphs.length = write;
      return out;
    },

    /** Screen-space rocket position and geometry, for the renderer. */
    get rocket() {
      const screen = rocketScreen();
      return { x: screen.x, y: screen.y, scale: rocketScale, stickLength };
    },

    /** Preload the display faces so the first sample is never Georgia-shaped. */
    prepare() {
      return ensureFontsReady();
    },

    start() {
      if (state !== 'idle') return;
      state = 'running';
      t = 0;
      fuseEmberClock = 0;
      finishedFired = false;
      failed = false;
      if (prompt) prompt.hide();
      setpiece.stopIdleDemo();
    },

    /**
     * One frame. Wrapped so that a fault in any beat cannot freeze the sky:
     * the invitation still has to arrive, which is the whole point of the page.
     */
    update(dt) {
      if (state !== 'running') return;
      try {
        step(dt);
      } catch (error) {
        failed = true;
        console.error('[nikkah] sequence fault, showing the invitation', error);
        flying = false;
        finish();
      }
    },

    /** New viewport: drop the cached layouts so text is re-laid-out and re-sampled. */
    resize(nextView, nextMetrics, nextSetpiece) {
      view = nextView;
      metrics = nextMetrics || metrics;
      if (nextSetpiece) setpiece = nextSetpiece;
      lineLayouts.line1 = null;
      lineLayouts.line2 = null;
      lineLayouts.line3 = null;
      invalidatePointCache();
      if (flying) apexY = view.height * APEX_VIEW_RATIO;
    },

    /** Back to the opening frame. Plan 8.2 replays this indefinitely. */
    reset() {
      state = 'idle';
      phase = 'idle';
      t = 0;
      flying = false;
      finishedFired = false;
      failed = false;
      fuseEmberClock = 0;
      calmIndex = 0;
      calmAlpha = 0;
      glyphs = [];
      surpriseGroups = [];
      lineGroups.line1 = [];
      lineGroups.line2 = [];
      lineGroups.line3 = [];
      lineGroups.dateline = [];
      particles.reset();
      trail.reset();
      setpiece.reset();
      camera.reset();
      sound.stopAll();
      if (prompt) prompt.show();
    },

    /** `{ ok, total, target, tolerance }` — the Phase 7 runtime assertion. */
    runtime() {
      return checkRuntime();
    },
  };

  return director;
}
