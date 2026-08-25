/**
 * The opening prompt and the two language labels.
 *
 * Real DOM, not canvas: this is the only instruction on the page, so it has to
 * be selectable, zoomable and readable by a screen reader — and it has to stay
 * crisp at any device pixel ratio, which canvas text on a 1x phone does not.
 *
 * There are two fireworks on the ground and lighting one picks the language,
 * so the prompt is bilingual by necessity: a viewer who only reads Urdu must
 * be told what to do in Urdu, and one who only reads English likewise, without
 * either of them having chosen anything yet. Each rocket also carries its own
 * label, positioned from its rendered location by `main.js`, so the choice is
 * legible even to someone who reads neither line of the instruction.
 */

import { CONTENT_EN, CONTENT_UR } from '../config/content.js';

/** Must match the `transition` duration on `.prompt-pill` in style.css. */
const FADE_MS = 320;

function makeEl(tag, className, text, lang, dir) {
  const el = document.createElement(tag);
  el.className = className;
  // textContent, never innerHTML — the copy is data, not markup.
  el.textContent = text;
  if (lang) el.lang = lang;
  if (dir) el.dir = dir;
  return el;
}

/**
 * Create the prompt and its two station labels.
 *
 * @param {HTMLElement} host usually `#ui`
 * @returns {{
 *   el: HTMLElement,
 *   labels: { en: HTMLElement, ur: HTMLElement },
 *   show: () => void,
 *   hide: () => void,
 *   visible: boolean,
 *   dispose: () => void,
 * }}
 */
export function createPrompt(host) {
  // --- the bilingual instruction ---------------------------------------
  const el = document.createElement('div');
  el.className = 'prompt-pill';
  el.appendChild(makeEl('span', 'prompt-line', CONTENT_EN.chooser, 'en', 'ltr'));
  el.appendChild(
    makeEl('span', 'prompt-line prompt-line--urdu', CONTENT_UR.chooser, 'ur', 'rtl')
  );
  host.appendChild(el);

  // --- one label per firework ------------------------------------------
  const labels = {
    en: makeEl('div', 'lang-label', CONTENT_EN.label, 'en', 'ltr'),
    ur: makeEl('div', 'lang-label lang-label--urdu', CONTENT_UR.label, 'ur', 'rtl'),
  };
  host.appendChild(labels.en);
  host.appendChild(labels.ur);

  const all = [el, labels.en, labels.ur];

  let visible = true;
  let fadeId = 0;

  const api = {
    el,
    labels,

    get visible() {
      return visible;
    },

    /** Bring it back — used by replay, which returns to the language choice. */
    show() {
      clearTimeout(fadeId);
      for (const node of all) {
        node.hidden = false;
        // Force a style flush between `hidden = false` and dropping the class,
        // otherwise the browser coalesces both into one frame and there is no
        // fade at all.
        void node.offsetWidth;
        node.classList.remove('prompt-pill--out');
      }
      visible = true;
    },

    /**
     * Fade out, then take it out of the layout entirely. Called the instant a
     * firework is lit, so nothing sits over the flight.
     */
    hide() {
      if (!visible) return;
      visible = false;
      for (const node of all) node.classList.add('prompt-pill--out');
      clearTimeout(fadeId);
      // A UI transition timer, not sequence timing — the director drives the
      // show from the loop's accumulated elapsed, never from a timer.
      fadeId = setTimeout(() => {
        for (const node of all) node.hidden = true;
      }, FADE_MS);
    },

    dispose() {
      clearTimeout(fadeId);
      for (const node of all) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    },
  };

  return api;
}
