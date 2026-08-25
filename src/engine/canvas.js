/**
 * DPR-correct canvas sizing and debounced resize handling.
 *
 * Everything downstream of this module draws in CSS pixels and never thinks
 * about device pixel ratio again.
 */

/**
 * Cap on `devicePixelRatio`. A 3x phone would otherwise ask us to fill nine
 * times the pixels of a 1x screen every frame, which is where low-end devices
 * fall off 30 fps. 2 is the point past which the extra sharpness stops being
 * visible on a firework spark anyway.
 */
export const MAX_DPR = 2;

/** Resize debounce, in ms. Per plan 2.4. */
const RESIZE_DEBOUNCE_MS = 100;

/** Current effective device pixel ratio, capped. */
export function currentDpr() {
  const raw = window.devicePixelRatio || 1;
  return Math.min(raw, MAX_DPR);
}

/**
 * Size a canvas correctly and keep it that way.
 *
 * @param {HTMLCanvasElement} canvasEl
 * @param {(size: { width: number, height: number, dpr: number }) => void} [onResize]
 *   Called after every re-layout EXCEPT the initial one. Scenes use it to
 *   regenerate size-dependent geometry: star field, grass, treeline, cloud
 *   banks, text point caches.
 *
 *   The first layout deliberately does not fire it. `setupCanvas` returns with
 *   the canvas already sized, so the caller builds its initial geometry
 *   straight from the returned `width`/`height` — and a callback that closes
 *   over the return value cannot be invoked before that value exists.
 * @returns {{
 *   ctx: CanvasRenderingContext2D,
 *   resize: () => void,
 *   width: number,
 *   height: number,
 *   dpr: number,
 *   dispose: () => void,
 * }} `width`, `height` and `dpr` are live getters — they always report the
 *   current layout, never a stale snapshot from setup time.
 */
export function setupCanvas(canvasEl, onResize) {
  // alpha: false — the sky always paints every pixel, so an opaque backing
  // store lets the compositor skip per-pixel blending against the page.
  const ctx = canvasEl.getContext('2d', { alpha: false });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let debounceId = 0;
  let laidOut = false;

  function resize() {
    // The stage is `100dvh` and the canvas fills it, so the CSS-pixel size of
    // the drawing surface is the viewport. `window.innerWidth/innerHeight` is
    // what the allow-list offers and it tracks the dynamic viewport, which is
    // exactly what `dvh` resolves to.
    //
    // Floored at 1: a viewport can genuinely report 0 for a moment (a hidden
    // container, an iframe measured before layout), and a 0-wide backing store
    // makes every later draw a silent no-op.
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const nextDpr = currentDpr();

    // Assigning width/height resets the backing store — skip the work (and
    // the state reset) when nothing actually changed. Mobile browsers fire
    // `resize` on every address-bar nudge.
    //
    // `laidOut` is what separates "unchanged" from "never run". Without it a
    // first layout at a 0x0 viewport matches the zero-initialised state and
    // returns early, leaving the canvas at its 300x150 default with an
    // identity transform, forever.
    if (laidOut && cssW === width && cssH === height && nextDpr === dpr) return;

    const first = !laidOut;
    laidOut = true;

    width = cssW;
    height = cssH;
    dpr = nextDpr;

    // Backing store in device pixels...
    canvasEl.width = Math.round(cssW * dpr);
    canvasEl.height = Math.round(cssH * dpr);

    // ...and the CSS box in CSS pixels. The stylesheet already sets
    // width/height to 100%, but pinning it here keeps the element correct even
    // if the canvas is ever used outside that layout.
    canvasEl.style.setProperty('width', `${cssW}px`);
    canvasEl.style.setProperty('height', `${cssH}px`);

    // Writing to canvas.width/height wipes the 2D context state, transform
    // included, so the scale has to be reapplied after every single resize.
    // setTransform (not scale) because it assigns rather than multiplies —
    // repeated resizes can never compound it.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // See the @param note: the initial layout never fires the callback.
    if (!first && onResize) onResize({ width, height, dpr });
  }

  // Debounced: a desktop drag-resize fires dozens of events a second, and
  // regenerating 520 grass blades and a text point cache on each one would
  // stall the frame. `setTimeout` here is a debounce timer only — sequence
  // timing is driven by the loop's accumulated elapsed, never by timers.
  function scheduleResize() {
    clearTimeout(debounceId);
    debounceId = setTimeout(resize, RESIZE_DEBOUNCE_MS);
  }

  window.addEventListener('resize', scheduleResize);
  // iOS reports the pre-rotation viewport size at `orientationchange` time,
  // which the debounce also happens to ride out.
  window.addEventListener('orientationchange', scheduleResize);

  // A hidden tab can be resized without its `resize` event being delivered
  // until it is shown again — open the link in a background tab, rotate the
  // phone, come back, and the canvas would still be sized for the old
  // viewport. Re-measuring on the way back in costs nothing: `resize()`
  // returns immediately when the size really is unchanged.
  function onVisibilityChange() {
    if (document.visibilityState === 'visible') resize();
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Initial layout, synchronous so the first frame is already correct.
  resize();

  function dispose() {
    clearTimeout(debounceId);
    window.removeEventListener('resize', scheduleResize);
    window.removeEventListener('orientationchange', scheduleResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    ctx,
    resize,
    dispose,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get dpr() {
      return dpr;
    },
  };
}
