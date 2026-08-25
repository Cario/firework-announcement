import './style.css';

import { setupCanvas } from './engine/canvas.js';
import { createLoop } from './engine/loop.js';
import { createCamera } from './engine/camera.js';
import { createRng, SEEDS } from './engine/rng.js';

import { createWorldMetrics, createSky } from './scene/sky.js';
import { createGround } from './scene/ground.js';
import { createClouds } from './scene/clouds.js';
import { createSetpiece } from './scene/setpiece.js';
import { drawRocket } from './scene/rocket.js';

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

  function render(dt) {
    director.update(dt);

    sky.update(dt);
    ground.update(dt);
    clouds.update(dt);
    setpiece.update(dt);
    particles.update(dt);

    sky.draw(ctx, camera);
    clouds.draw(ctx, camera, 'behind');
    ground.draw(ctx, camera);
    setpiece.draw(ctx, camera);

    if (director.flying) {
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
