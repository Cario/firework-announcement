/**
 * The idle prompt pill.
 *
 * Real DOM, not canvas: it is the one instruction on the page, so it has to be
 * selectable, zoomable, and readable by a screen reader — and it has to stay
 * crisp at any device pixel ratio, which canvas text on a 1x phone does not.
 *
 * Position, colour and type come from `src/style.css` (`.prompt-pill`), which
 * places it just above the rocket: `bottom: 41%` on desktop, `30%` on a narrow
 * viewport, matching the storyboard's `.cue`.
 */

import { CONTENT } from '../config/content.js';

/** Must match the `transition` duration on `.prompt-pill` in style.css. */
const FADE_MS = 320;

/**
 * Create the prompt and attach it to a host element.
 *
 * @param {HTMLElement} host usually `#ui`
 * @param {{ text?: string }} [options]
 * @returns {{
 *   el: HTMLParagraphElement,
 *   show: () => void,
 *   hide: () => void,
 *   visible: boolean,
 *   dispose: () => void,
 * }}
 */
export function createPrompt(host, options = {}) {
  const el = document.createElement('p');
  el.className = 'prompt-pill';
  // textContent, never innerHTML — the copy is data, not markup.
  el.textContent = options.text ?? CONTENT.prompt;
  host.appendChild(el);

  let visible = true;
  let fadeId = 0;

  const api = {
    el,

    get visible() {
      return visible;
    },

    /** Bring it back — used by replay. */
    show() {
      clearTimeout(fadeId);
      el.hidden = false;
      // Force a style flush between `hidden = false` and dropping the class,
      // otherwise the browser coalesces both into one frame and the pill
      // appears without its fade.
      void el.offsetWidth;
      el.classList.remove('prompt-pill--out');
      visible = true;
    },

    /**
     * Fade out, then take it out of the layout entirely. Called the instant
     * the sequence starts, so it can never sit over the flight.
     */
    hide() {
      if (!visible) return;
      visible = false;
      el.classList.add('prompt-pill--out');
      clearTimeout(fadeId);
      // A UI transition timer, not sequence timing — the director drives the
      // show from the loop's accumulated elapsed, never from a timer.
      fadeId = setTimeout(() => {
        el.hidden = true;
      }, FADE_MS);
    },

    dispose() {
      clearTimeout(fadeId);
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };

  return api;
}
