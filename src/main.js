import './style.css';

import { setupCanvas } from './engine/canvas.js';
import { createLoop } from './engine/loop.js';
import { createCamera } from './engine/camera.js';
import { createRng, SEEDS } from './engine/rng.js';

import { createWorldMetrics, createSky } from './scene/sky.js';
import { createGround } from './scene/ground.js';
import { createClouds } from './scene/clouds.js';
import { createSetpiece } from './scene/setpiece.js';
import { createPrompt } from './ui/prompt.js';

/**
 * Boot.
 *
 * Phase 3 renders the approved opening frame at rest: a seeded starfield over
 * a graded night sky, a meadow of hills, treeline and grass, the cloud banks
 * waiting above the frame for the climb, the interaction set-piece, and the
 * prompt pill.
 *
 * The scene modules are deliberately passive — they expose `update(dt)` and
 * `draw(ctx, camera)` and know nothing about the sequence. Phase 5 drives the
 * camera and calls `setpiece.startFuseBurn()`; nothing here has to change.
 */

const canvasEl = document.getElementById('scene');
const uiEl = document.getElementById('ui');

if (!canvasEl) {
  console.error('[nikkah] #scene canvas not found');
} else {
  const camera = createCamera();

  let metrics = null;
  let sky = null;
  let ground = null;
  let clouds = null;
  let setpiece = null;

  const view = setupCanvas(canvasEl, ({ width, height }) => {
    relayout(width, height);
    render(0); // repaint immediately, so a resize never shows a stale frame
  });

  const { ctx } = view;

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

    // At rest the camera sits at the bottom of the world, showing the meadow.
    camera.reset();
  }

  relayout(view.width, view.height);

  const prompt = uiEl ? createPrompt(uiEl) : null;

  function render(dt) {
    sky.update(dt);
    ground.update(dt);
    clouds.update(dt);
    setpiece.update(dt);

    // Painter's order. The cloud stack is split around the set-piece so the
    // rocket passes behind the far banks and in front of the near ones once
    // the climb starts.
    sky.draw(ctx, camera);
    clouds.draw(ctx, camera, 'behind');
    ground.draw(ctx, camera);
    setpiece.draw(ctx, camera);
    clouds.draw(ctx, camera, 'front');
  }

  const loop = createLoop(render);

  // Paint once synchronously. The loop pauses itself while the tab is hidden,
  // so without this a page opened in a background tab would sit on an empty
  // black canvas until it was first looked at.
  render(0);
  loop.start();

  if (import.meta.env.DEV) {
    // Determinism probe. Dev only — stripped from every production build, so
    // the shipped console stays clean. Reload the page: these four numbers
    // must be identical every single time, which is what guarantees the
    // starfield, grass and cloud silhouettes are too.
    const probe = createRng(SEEDS.scenery);
    console.info(
      '[nikkah] seeded rng probe',
      [probe.next(), probe.next(), probe.next(), probe.next()]
        .map((n) => n.toFixed(9))
        .join(' ')
    );

    console.info(
      `[nikkah] scene ${view.width}x${view.height} css @ dpr ${view.dpr} — ` +
        `world ${Math.round(metrics.worldHeight)}px, ` +
        `${sky.starCount} stars, ${ground.counts.trees} trees, ` +
        `${ground.counts.blades} blades, ${clouds.banks.length} cloud banks, ` +
        `set-piece scale ${setpiece.scale}`
    );

    // Expose the scene for manual probing from the console during review.
    window.__nikkah = { view, camera, sky, ground, clouds, setpiece, prompt, loop };
  }
}
