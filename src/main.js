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

import { createPrompt } from './ui/prompt.js';
import { createMuteToggle } from './ui/muteToggle.js';
import { createInviteCard } from './ui/inviteCard.js';

import * as sound from './audio/sound.js';
import { createDirector } from './sequence/director.js';

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
    } else {
      sky.resize(metrics);
      ground.resize(metrics);
      clouds.resize(metrics);
      setpiece.resize(metrics);
    }

    if (!director || director.state === 'idle') camera.reset();
  }

  relayout(view.width, view.height);

  const prompt = uiEl ? createPrompt(uiEl) : null;
  createMuteToggle({ mount: uiEl || stageEl });

  const card = createInviteCard({
    mount: uiEl || stageEl,
    a11yTarget: a11yEl,
    onReplay: () => {
      card.hide();
      director.reset();
      armed = true;
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
    onFinished: () => card.show(),
  });

  // Warm the display faces now, while the viewer is still looking at the
  // opening frame. Sampling a glyph before its webfont has arrived silently
  // produces Georgia-shaped text, and the first sample happens 4 s after the
  // tap — this makes sure it has landed long before then.
  director.prepare();

  /* ---------------------------------------------------------------- *
   * Input — the whole viewport is the target
   * ---------------------------------------------------------------- */

  let armed = true;

  function ignite() {
    if (!armed || director.state !== 'idle') return;
    armed = false;
    // Audio has to be created inside the gesture, and must never be able to
    // hold up the visuals: `initAudio` always resolves, and the sequence
    // starts regardless of what it resolves to.
    sound.initAudio().then(() => sound.play('fuse'));
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
      ignite();
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
  const OPEN_SPAN = 0.62;
  const OPEN_SPAN_V = 0.72;
  // High enough that even a 2560-wide monitor still gets the intended crop
  // rather than falling short of it; the scene is vector, so it stays crisp.
  const OPEN_ZOOM_MAX = 4.8;

  function openZoom() {
    const pieceWidth = SETPIECE_WIDTH * metrics.setpieceScale;
    const pieceHeight = SETPIECE_HEIGHT * metrics.setpieceScale;

    // Both axes, then the smaller. Width alone is right for tall phones but
    // would crop the rocket on a short landscape window — 812x375 wants a
    // tighter crop than its width implies. Taking the minimum means the
    // firework holds the same apparent size across aspect ratios instead of
    // being framed by whichever dimension happens to be generous.
    const byWidth = (OPEN_SPAN * view.width) / pieceWidth;
    const byHeight = (OPEN_SPAN_V * view.height) / pieceHeight;

    return Math.max(1, Math.min(OPEN_ZOOM_MAX, Math.min(byWidth, byHeight)));
  }

  /** Screen-space point the crop is centred on: the firework, then the rocket. */
  function focalPoint() {
    if (director.flying) {
      const r = director.rocket;
      return { x: r.x, y: r.y };
    }
    // Anchored near the foot of the set-piece rather than its middle: content
    // moves away from the focal point, so pinning the base lifts the whole
    // firework up into the frame instead of pushing it off the bottom.
    const c = setpiece.localToWorld(SETPIECE_WIDTH / 2, SETPIECE_HEIGHT * 0.96);
    return { x: c.x, y: c.y - camera.y };
  }

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
    ctx.save();
    if (zoomed) {
      const f = focalPoint();
      ctx.translate(f.x, f.y);
      ctx.scale(zoom, zoom);
      ctx.translate(-f.x, -f.y);
    }

    sky.draw(ctx, camera);
    clouds.draw(ctx, camera, 'behind');
    ground.draw(ctx, camera);
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
      drawRocket(ctx, r.x, r.y, r.scale, 0, { stickLength: r.stickLength });
      clouds.draw(ctx, camera, 'front');
    } else {
      clouds.draw(ctx, camera, 'front');
      particles.render(ctx);
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
