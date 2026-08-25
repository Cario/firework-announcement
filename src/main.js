import './style.css';

import { PALETTE } from './config/palette.js';
import { setupCanvas } from './engine/canvas.js';
import { createLoop } from './engine/loop.js';
import { createRng, SEEDS } from './engine/rng.js';

/**
 * Boot.
 *
 * Phase 2 wires only enough to prove the engine: a DPR-correct canvas, a
 * running loop, a placeholder sky gradient, and correct behaviour on resize
 * and rotate. The scene, audio, particle system and sequence director arrive
 * in later phases and hang off exactly these three objects.
 */

const canvasEl = document.getElementById('scene');

if (!canvasEl) {
  console.error('[nikkah] #scene canvas not found');
} else {
  /** Cached sky gradient. A gradient is tied to the size it was built at, so
   *  it is rebuilt on re-layout rather than allocated every frame. */
  let sky = null;

  const view = setupCanvas(canvasEl, () => {
    sky = null; // invalidate at the new size
    render(); // repaint immediately, so a resize never shows a stale frame
  });

  const { ctx } = view;

  function buildSky(height) {
    // Vertical night sky: zenith -> mid at 60% -> horizon at the bottom.
    // Placeholder for Phase 3's src/scene/sky.js, which adds the starfield
    // and extends the gradient over the full ~3.2-screen world column.
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, PALETTE.night0);
    gradient.addColorStop(0.6, PALETTE.night1);
    gradient.addColorStop(1, PALETTE.night2);
    return gradient;
  }

  function render() {
    const { width, height } = view;
    if (!sky) sky = buildSky(height);

    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
  }

  const loop = createLoop(render);

  // Paint once synchronously. The loop pauses itself while the tab is hidden,
  // so without this a page opened in a background tab would sit on an empty
  // black canvas until it was first looked at.
  render();
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

    // Loop proof: report once, about a second in.
    let frames = 0;
    const reporter = createLoop((dt, elapsed) => {
      frames++;
      if (elapsed >= 1) {
        console.info(
          `[nikkah] loop ${frames} frames in ${elapsed.toFixed(3)}s, last dt ${dt.toFixed(4)}s, ` +
            `canvas ${view.width}x${view.height} css @ dpr ${view.dpr}`
        );
        reporter.dispose();
      }
    });
    reporter.start();
  }
}
