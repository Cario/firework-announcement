import './style.css';

import { setupCanvas } from './engine/canvas.js';
import { createLoop } from './engine/loop.js';
import { createCamera } from './engine/camera.js';
import { createRng, SEEDS } from './engine/rng.js';

import { createWorldMetrics, createSky } from './scene/sky.js';
import { createGround } from './scene/ground.js';
import { createClouds } from './scene/clouds.js';
import {
  createSetpiece,
  SETPIECE_WIDTH,
  SETPIECE_HEIGHT,
} from './scene/setpiece.js';
import { drawRocket } from './scene/rocket.js';
import { easeInOutCubic } from './engine/easing.js';

import { PALETTE } from './config/palette.js';
import { createParticles, particleCap } from './fx/particles.js';
import { createTrail } from './fx/trail.js';
import { drawDisplayText } from './fx/textPoints.js';

import { createPrompt } from './ui/prompt.js';
import { createMuteToggle } from './ui/muteToggle.js';
import { createInviteCard } from './ui/inviteCard.js';
import { createLoader } from './ui/loader.js';
import { createBackdrop } from './scene/backdrop.js';

import * as sound from './audio/sound.js';
import { createDirector } from './sequence/director.js';
import { getContent } from './config/content.js';
import { createTimeline } from './config/timeline.js';
import { ensureFontsReady, setTextLanguage } from './fx/textPoints.js';

/**
 * Boot.
 *
 * The scene draws in world space through the camera; the particle pool draws
 * in screen space. The two meet at the flying rocket, whose screen position
 * the director publishes each frame.
 *
 * Paint order changes once between the two halves of the show. While the
 * rocket is climbing it sits inside the cloud stack, so the near banks can
 * pass in front of it. After the burst there is no rocket, and the text needs
 * to be the frontmost thing in the sky, so the particles move ahead of the
 * clouds instead.
 */

const canvasEl = document.getElementById('scene');
const uiEl = document.getElementById('ui');
const a11yEl = document.getElementById('a11y-text');
const stageEl = document.getElementById('stage');

if (!canvasEl) {
  console.error('[nikkah] #scene canvas not found');
} else {
  const camera = createCamera();

  let metrics = null;
  let sky = null;
  let ground = null;
  let clouds = null;
  let setpiece = null;
  let backdrop = null;

  // Declared up here because `relayout` runs before the director exists — the
  // first call happens while the canvas is still being set up.
  let director = null;

  const view = setupCanvas(canvasEl, ({ width, height }) => {
    relayout(width, height);
    if (director) director.resize(view, metrics, setpiece);
    render(0);
  });

  const { ctx } = view;

  const particles = createParticles({ max: particleCap() });
  const trail = createTrail(particles);

  /** Rebuild every size-dependent piece of geometry for a new viewport. */
  function relayout(width, height) {
    metrics = createWorldMetrics(width, height);

    camera.setViewport(width, height);
    camera.setWorldHeight(metrics.worldHeight);

    if (!sky) {
      sky = createSky(metrics);
      ground = createGround(metrics);
      clouds = createClouds(metrics);
      setpiece = createSetpiece(metrics);
      // One waiting firework per word the longest announcement will spell out,
      // so every shell that goes up has somewhere on the ground it came from.
      backdrop = createBackdrop(metrics, { rocketCount: 32, mortarCount: 6 });
    } else {
      sky.resize(metrics);
      ground.resize(metrics);
      clouds.resize(metrics);
      setpiece.resize(metrics);
      backdrop.resize(metrics);
    }

    if (!director || director.state === 'idle') camera.reset();
  }

  relayout(view.width, view.height);

  const prompt = uiEl ? createPrompt(uiEl) : null;
  createMuteToggle({ mount: uiEl || stageEl });

  let card = null;

  /**
   * Stand-in while the viewer is still choosing a firework.
   *
   * Two fireworks are on the ground and neither has been lit, so there is no
   * language yet and therefore no schedule and no card. Rather than scatter
   * null checks through the render loop, an inert director satisfies the same
   * shape and simply does nothing.
   */
  const IDLE_DIRECTOR = {
    state: 'idle',
    phase: 'idle',
    elapsed: 0,
    openness: 0,
    flying: false,
    failed: false,
    reducedMotion: false,
    calmLine: null,
    glyphList: [],
    rocket: { x: 0, y: 0, scale: 1, stickLength: 0 },
    update() {},
    start() {},
    reset() {},
    resize() {},
    prepare() {
      return Promise.resolve(true);
    },
    runtime() {
      return { ok: true, total: 0, target: 30, tolerance: 0.5 };
    },
  };

  director = IDLE_DIRECTOR;

  /**
   * Commit to a language and build everything that depends on it.
   *
   * The timeline is derived from that language's own strings, so Urdu — whose
   * lines break into different numbers of words — gets its own number of
   * fireworks, and the card, the replay button and the sky text all switch
   * script and reading direction together.
   */
  function buildForLanguage(lang) {
    const content = getContent(lang);
    setTextLanguage(content);
    document.documentElement.lang = content.htmlLang;

    if (card) card.dispose();
    card = createInviteCard({
      mount: uiEl || stageEl,
      a11yTarget: a11yEl,
      content,
      onReplay: () => {
        card.hide();
        returnToChooser();
      },
    });

    director = createDirector({
      view,
      camera,
      metrics,
      setpiece,
      particles,
      trail,
      sound,
      prompt,
      content,
      timeline: createTimeline(content),
      onFinished: () => card.show(),
    });

    return director;
  }

  /** Back to two unlit fireworks, so the language can be chosen again. */
  function returnToChooser() {
    director.reset();
    director = IDLE_DIRECTOR;
    particles.reset();
    trail.reset();
    setpiece.reset();
    camera.reset();
    sound.stopAll();
    if (prompt) prompt.show();
    armed = true;
  }

  // Warm BOTH display faces now, while the viewer is still choosing. Sampling
  // a glyph before its webfont has arrived silently produces a fallback-shaped
  // cloud, and the first sample happens 4 s after the tap — this makes sure
  // Cormorant and Nastaliq have both landed long before then, whichever
  // firework gets lit.
  ensureFontsReady();

  /* ---------------------------------------------------------------- *
   * Input — the whole viewport is the target
   * ---------------------------------------------------------------- */

  // Nothing is armed until the loading screen is dismissed: a stray tap that
  // lands as the overlay fades would otherwise light a firework the viewer
  // never saw, and choose their language for them.
  let armed = false;

  const loader = createLoader(stageEl || document.body, {
    onContinue: () => {
      armed = true;
      primeAudio();
    },
  });

  /**
   * Audio unlock, separate from ignition.
   *
   * Mobile browsers do not accept every gesture as permission to play sound.
   * `pointerdown` — which is what lights the fuse, because it feels instant —
   * is one they historically refuse: iOS Safari grants audio on `click` and
   * `touchend`, not on `touchstart`. The result was that the first run played
   * silently and everything worked from the "Watch again" button onwards,
   * because that button is a real click and was the first gesture the browser
   * would honour.
   *
   * So the unlock is attached to every gesture type, and keeps retrying until
   * the context is genuinely `running`, at which point it detaches itself.
   */
  const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

  function detachUnlock() {
    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, primeAudio, true);
    }
  }

  function primeAudio() {
    if (sound.isRunning()) {
      detachUnlock();
      return;
    }
    sound.initAudio().then((ok) => {
      if (ok) detachUnlock();
    });
  }

  for (const type of UNLOCK_EVENTS) {
    // Capture phase, so the mute button's stopPropagation cannot hide a
    // perfectly good unlock gesture from us.
    window.addEventListener(type, primeAudio, true);
  }

  /**
   * Screen x -> world x, undoing the opening crop.
   *
   * The crop scales the whole composited frame about a focal point, so a tap
   * at the left-hand rocket lands at a different screen x than the rocket's
   * world x. Without this the hit test picks the wrong firework — and so the
   * wrong language — at every viewport where the crop is active, which is all
   * of them.
   */
  function screenToWorldX(screenX) {
    if (lastZoom <= 1.001) return screenX;
    return lastFocal.x + (screenX - lastFocal.x) / lastZoom;
  }

  function ignite(event) {
    if (!armed || director.state !== 'idle') return;
    armed = false;

    // Which firework was that? Nearest one wins, so a tap that lands in the
    // grass beside a rocket still chooses the language it was aimed at.
    const rect = (stageEl || document.body).getBoundingClientRect();
    const screenX =
      event && typeof event.clientX === 'number'
        ? event.clientX - rect.left
        : view.width / 2;
    const lang = setpiece.hitTest(screenToWorldX(screenX));
    setpiece.choose(lang);
    buildForLanguage(lang);
    // Audio has to be created inside the gesture, and must never be able to
    // hold up the visuals: `initAudio` always resolves, and the sequence
    // starts regardless of what it resolves to.
    //
    // Nothing is played here. The fuse sound belongs to the moment the match
    // touches the cord, not to the tap — the timeline owns that cue. Playing
    // it here as well was also stacking two copies of the same voice, which
    // is what made it twice as loud as everything else.
    // Ask for audio here too, but do not judge the answer: a refusal on this
    // gesture is expected on mobile, and `primeAudio` keeps trying on the
    // gesture types the browser does honour.
    primeAudio();
    director.start();
  }

  const target = stageEl || document;
  target.addEventListener('pointerdown', ignite);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      // Let the replay button and the mute toggle keep their own keyboard
      // behaviour instead of igniting the sequence underneath them.
      const el = document.activeElement;
      if (el && el.tagName === 'BUTTON') return;
      event.preventDefault();
      // No pointer to aim with: default to the English firework, which is the
      // left-hand one and the first in reading order.
      ignite(null);
    }
  });

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  /**
   * Reduced-motion text. Wrapped to the viewport and drawn plainly, with none
   * of the spark choreography — the words still have to arrive.
   */
  function drawCalmLine(line) {
    if (!line) return;

    const size = Math.max(19, Math.min(64, view.width * line.size));
    ctx.save();
    ctx.globalAlpha = line.alpha;
    ctx.fillStyle = PALETTE.goldHi;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${line.italic ? 'italic ' : ''}600 ${size}px "Cormorant Garamond", Georgia, serif`;

    const maxWidth = view.width * 0.86;
    const words = line.text.split(' ');
    const rows = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        rows.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) rows.push(current);

    const pitch = size * 1.4;
    const top = view.height / 2 - ((rows.length - 1) * pitch) / 2;
    for (let i = 0; i < rows.length; i += 1) {
      ctx.fillText(rows[i], view.width / 2, top + i * pitch);
    }
    ctx.restore();
  }

  /**
   * The opening crop.
   *
   * The set-piece is a fixed number of world pixels wide, so on a large
   * monitor it was a small object in a big landscape while on a phone it
   * nearly filled the frame — the same scene reading completely differently
   * depending on the screen. This scales the whole composited frame so the
   * firework occupies the SAME fraction of the viewport whatever the size or
   * aspect ratio, then pulls back to 1 as the rocket climbs.
   */
  /** Last frame's crop, so a tap can be mapped back into world space. */
  let lastZoom = 1;
  let lastFocal = { x: 0, y: 0 };

  const OPEN_SPAN = 0.9;
  const OPEN_SPAN_V = 0.72;

  /**
   * Where the horizon should sit in the cropped frame, as a fraction of its
   * height. This is what keeps the treeline in shot.
   *
   * The crop is anchored to the bottom edge of the viewport, so the ground
   * stays pinned there and the zoom eats into the sky. Left unbounded that is
   * exactly what happened on a wide monitor: at 1440x900 the frame came out
   * 78% ground, and past 2000px the horizon left the top of the screen
   * altogether — a camera pointed at the grass. Solving the mapping for a
   * fixed horizon gives a hard ceiling on the zoom instead.
   */
  const HORIZON_TARGET = 0.3;

  function openZoom() {
    const pieceWidth = SETPIECE_WIDTH * metrics.setpieceScale;
    const pieceHeight = SETPIECE_HEIGHT * metrics.setpieceScale;

    // How big the firework wants to be, on each axis.
    const byWidth = (OPEN_SPAN * view.width) / pieceWidth;
    const byHeight = (OPEN_SPAN_V * view.height) / pieceHeight;

    // How big the composition will tolerate. With the focal point on the
    // bottom edge, an unzoomed y maps to vh + (y - vh) * z, so the horizon
    // (at 1 - groundRatio) lands at HORIZON_TARGET when
    //   z = (1 - HORIZON_TARGET) / groundRatio.
    const groundRatio = metrics.groundHeight / view.height;
    const byHorizon = (1 - HORIZON_TARGET) / Math.max(0.01, groundRatio);

    return Math.max(1, Math.min(byWidth, byHeight, byHorizon));
  }

  /**
   * Screen-space point the crop expands around.
   *
   * The bottom edge of the viewport while the firework is on the ground: that
   * pins the meadow to the bottom of the frame no matter how tight the crop,
   * so the zoom only ever eats sky. Once the rocket is away it tracks the
   * rocket instead, so the pull-back stays centred on the subject.
   */
  function focalPoint() {
    if (director.flying) {
      const r = director.rocket;
      return { x: r.x, y: r.y };
    }
    return { x: view.width / 2, y: view.height };
  }

  /**
   * Keep the prompt clear of the firework.
   *
   * The set-piece's position on screen depends on the crop, which varies with
   * viewport size, so any fixed `bottom` percentage lands on the rocket at
   * some sizes and miles away at others. This measures the rendered top of the
   * rocket — through the same zoom transform the canvas uses — and parks the
   * text a fixed gap above it, in the clear band of grass.
   */


  function render(dt) {
    director.update(dt);

    sky.update(dt);
    ground.update(dt);
    clouds.update(dt);
    setpiece.update(dt);
    particles.update(dt);

    // Framing. Everything below is drawn inside this transform — scene and
    // particles alike — so the crop can never put the two out of register.
    const zoom = 1 + (openZoom() - 1) * (1 - easeInOutCubic(director.openness));
    const zoomed = zoom > 1.001;
    const focal = focalPoint();

    lastZoom = zoom;
    lastFocal = focal;

    ctx.save();
    if (zoomed) {
      ctx.translate(focal.x, focal.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-focal.x, -focal.y);
    }

    sky.draw(ctx, camera);
    clouds.draw(ctx, camera, 'behind');
    ground.draw(ctx, camera);
    backdrop.draw(ctx, camera);
    setpiece.draw(ctx, camera);

    if (director.reducedMotion) {
      clouds.draw(ctx, camera, 'front');
      drawCalmLine(director.calmLine);
    } else if (director.flying) {
      // Mid-flight: smoke < embers < flame < rocket, all inside the cloud
      // stack so the near banks can occlude the whole assembly.
      const r = director.rocket;
      particles.render(ctx);
      trail.drawFlame(ctx, r.x, r.y + r.stickLength * r.scale, 0, r.scale);
      // The rocket in the air has to be the one they lit: the red English
      // firework or the blue Urdu one, not whichever the default happens to be.
      drawRocket(ctx, r.x, r.y, r.scale, 0, {
        stickLength: r.stickLength,
        livery: setpiece.chosenLivery,
      });
      clouds.draw(ctx, camera, 'front');
    } else {
      clouds.draw(ctx, camera, 'front');
      particles.render(ctx);
      drawGlyphs();
    }

    ctx.restore();

  }

  /**
   * The solid letters, fading up through their own embers.
   *
   * Sparks alone leave gaps in every stroke, which is what made the sky text
   * hard to read. The embers still do the forming; this is what they resolve
   * into.
   */
  function drawGlyphs() {
    const list = director.glyphList;
    if (!list.length) return;
    ctx.save();
    for (let i = 0; i < list.length; i += 1) {
      const { g, alpha } = list[i];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = PALETTE[g.color] || PALETTE.goldHi;
      drawDisplayText(ctx, g.text, g.x, g.y, {
        fontSize: g.fontSize,
        italic: g.italic,
        letterSpacing: g.letterSpacing,
        width: g.width,
      });
    }
    ctx.restore();
  }

  const loop = createLoop(render);

  render(0);
  loop.start();

  if (import.meta.env.DEV) {
    const probe = createRng(SEEDS.scenery);
    console.info(
      '[nikkah] seeded rng probe',
      [probe.next(), probe.next(), probe.next(), probe.next()]
        .map((n) => n.toFixed(9))
        .join(' ')
    );

    const runtime = director.runtime();
    console.info(
      `[nikkah] scene ${view.width}x${view.height} css @ dpr ${view.dpr} — ` +
        `world ${Math.round(metrics.worldHeight)}px, ` +
        `${sky.starCount} stars, ${ground.counts.trees} trees, ` +
        `${ground.counts.blades} blades, ${clouds.banks.length} cloud banks, ` +
        `set-piece scale ${setpiece.scale}, particle cap ${particles.max}`
    );
    console.info(
      `[nikkah] sequence runtime ${runtime.total.toFixed(2)}s ` +
        `(target ${runtime.target}s +/- ${runtime.tolerance}s) — ` +
        (runtime.ok ? 'OK' : 'OUT OF TOLERANCE')
    );

    window.__nikkah = {
      view,
      camera,
      sky,
      ground,
      clouds,
      setpiece,
      particles,
      trail,
      prompt,
      card,
      director,
      sound,
      loop,
      ignite,
    };
  }
}
