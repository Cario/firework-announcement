/**
 * requestAnimationFrame loop with clamped dt and visibility pausing.
 *
 * `elapsed` is accumulated from clamped frame deltas — it is deliberately NOT
 * `now - startTime`. That is what lets a tab sit hidden for five minutes and
 * resume mid-sequence exactly where it left off, with the audio still on its
 * visual beats.
 */

/**
 * Longest delta any single frame may report, in seconds.
 *
 * A stalled or backgrounded tab can hand back a delta of seconds. Integrating
 * that in one step teleports every particle across the screen and can push the
 * rocket through the burst before it is drawn. Clamping to 1/30 s means a slow
 * frame runs in slow motion rather than skipping — the right trade for a
 * 30-second piece that nobody is timing against a stopwatch.
 */
export const MAX_DT = 1 / 30;

/**
 * @param {(dt: number, elapsed: number) => void} update Called once per frame
 *   with the clamped delta and the total accumulated time, both in seconds.
 * @returns {{
 *   start: () => void,
 *   stop: () => void,
 *   reset: () => void,
 *   elapsed: number,
 *   running: boolean,
 * }} `elapsed` is a live getter, in seconds since `start()`.
 */
export function createLoop(update) {
  let rafId = 0;
  let running = false;
  let lastFrame = 0;
  let elapsed = 0;

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    let dt = (now - lastFrame) / 1000;
    lastFrame = now;

    // Guard against a non-monotonic or first-frame delta.
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;

    elapsed += dt;
    update(dt, elapsed);
  }

  function start() {
    if (running) return;
    running = true;
    // Reset the reference point so the frame after a pause reports a normal
    // delta instead of the whole hidden interval.
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /** Rewind the clock without touching the running state. For replay. */
  function reset() {
    elapsed = 0;
    lastFrame = performance.now();
  }

  // Most browsers already throttle rAF in a hidden tab, but not all of them
  // stop it, and none of them agree on the delta they hand back on return.
  // Pausing explicitly makes the behaviour ours: `elapsed` simply does not
  // advance while hidden, so nothing has to be un-jumped afterwards.
  let pausedByVisibility = false;

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      if (running) {
        pausedByVisibility = true;
        stop();
      }
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      start();
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start,
    stop,
    reset,
    /** Remove the visibility listener. Only needed if the loop is discarded. */
    dispose() {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
    get elapsed() {
      return elapsed;
    },
    get running() {
      return running;
    },
  };
}
