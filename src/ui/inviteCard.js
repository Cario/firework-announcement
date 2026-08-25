/**
 * Phase 8 — the parchment invitation card, and the replay control.
 *
 * Real DOM, never canvas: this is the payload of the whole site, so the
 * text has to be selectable, zoomable, and readable by a screen reader.
 * The card floats over the still-visible night sky on a flat dark scrim.
 *
 * Layout, colour and type live in `./inviteCard.css`, imported below so
 * the two files travel together and `src/style.css` stays untouched.
 *
 * Every string comes from `CONTENT.card` via `textContent` — verbatim,
 * never `innerHTML`, never reflowed. The one exception is the eyebrow
 * label, which the storyboard shows but `content.js` does not carry;
 * see `EYEBROW` below.
 *
 * Layout order is storyboard frame 5:
 *   eyebrow -> intro -> groom -> groom parents -> rule
 *           -> bride -> bride parents -> rule -> date -> location
 *
 * Source: docs/plans/01-implementation-plan.md § Phase 8
 *         docs/specs/2026-08-25-nikkah-invite-design.md § "Final card text"
 */

import { CONTENT_EN } from '../config/content.js';
import { PALETTE } from '../config/palette.js';
import './inviteCard.css';

/**
 * The small uppercase label above the invitation, present in storyboard
 * frame 5 and in the `<noscript>` fallback in index.html, but not a key
 * in `CONTENT.card` — `content.js` is out of scope for this phase, so it
 * is declared here rather than by silently editing that file. It is a
 * label, not part of the invitation wording.
 */


/** Must match `--card-enter` in inviteCard.css. */
const ENTER_MS = 900;

/**
 * The card's colour tokens, mapped from `PALETTE` onto the CSS custom
 * properties `inviteCard.css` reads. Applied with `style.setProperty` so
 * `src/config/palette.js` remains the single source of truth and no hex
 * literal ever appears in this file.
 */
const CARD_TOKENS = [
  ['--card-bg', PALETTE.cardBg],
  ['--card-ink', PALETTE.cardInk],
  ['--card-rule', PALETTE.rule],
  ['--card-gold', PALETTE.gold],
  ['--card-gold-hi', PALETTE.goldHi],
  ['--card-night-0', PALETTE.night0],
];

/** `<tag class="…">text</tag>`, with the text set as text, never markup. */
function makeLine(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function makeRule() {
  const hr = document.createElement('hr');
  hr.className = 'invite-rule';
  return hr;
}

/**
 * Build the invitation card and its replay button, mounted but hidden.
 *
 * @param {object} [options]
 * @param {HTMLElement} [options.mount] host element; defaults to `#ui`,
 *   falling back to `document.body`.
 * @param {() => void} [options.onReplay] called when the replay button is
 *   activated by pointer, Enter or Space. The card hides itself first, so
 *   the callback only has to reset the scene.
 * @param {HTMLElement|null} [options.a11yTarget] the polite live region to
 *   narrate into; defaults to `#a11y-text`.
 * @returns {{
 *   element: HTMLDivElement,
 *   replayButton: HTMLButtonElement,
 *   visible: boolean,
 *   show: () => void,
 *   hide: () => void,
 *   dispose: () => void,
 * }}
 */
export function createInviteCard(options = {}) {
  const mount =
    options.mount ?? document.getElementById('ui') ?? document.body;
  const onReplay = typeof options.onReplay === 'function' ? options.onReplay : null;
  const a11yTarget =
    options.a11yTarget === undefined
      ? document.getElementById('a11y-text')
      : options.a11yTarget;

  // The whole card follows one language: strings, reading direction, and the
  // face used to set them. Urdu is right-to-left and Nastaliq, both of which
  // are properties of the card element rather than of any individual string.
  const CONTENT = options.content || CONTENT_EN;
  const c = CONTENT.card;
  const EYEBROW = c.eyebrow;

  // --- structure ------------------------------------------------------

  const layer = document.createElement('div');
  layer.className = 'invite-layer';
  layer.hidden = true;
  for (const [name, value] of CARD_TOKENS) layer.style.setProperty(name, value);

  // Flat colour, no blur, no gradient — see `.invite-scrim`.
  const scrim = document.createElement('div');
  scrim.className = 'invite-scrim';
  layer.appendChild(scrim);

  const panel = document.createElement('div');
  panel.className = 'invite-panel';

  const card = document.createElement('div');
  card.className = 'invite-card';
  card.lang = CONTENT.htmlLang;
  card.dir = CONTENT.dir;
  if (CONTENT.lang === 'ur') card.classList.add('invite-card--urdu');

  card.appendChild(makeLine('p', 'invite-eyebrow', EYEBROW));
  card.appendChild(makeLine('h1', 'invite-intro', c.intro));
  card.appendChild(makeLine('p', 'invite-name', c.groom));
  card.appendChild(makeLine('p', 'invite-parents', c.groomParents));
  card.appendChild(makeRule());
  card.appendChild(makeLine('p', 'invite-name', c.bride));
  card.appendChild(makeLine('p', 'invite-parents', c.brideParents));
  card.appendChild(makeRule());
  card.appendChild(makeLine('p', 'invite-date', c.date));
  card.appendChild(makeLine('p', 'invite-location', c.location));

  // A real <button>: Enter and Space activate it with no extra keydown
  // handler, and it is in the tab order for free.
  const replayButton = document.createElement('button');
  replayButton.type = 'button';
  replayButton.className = 'invite-replay';
  replayButton.textContent = CONTENT.replay;
  replayButton.lang = CONTENT.htmlLang;
  replayButton.dir = CONTENT.dir;
  if (CONTENT.lang === 'ur') replayButton.classList.add('invite-replay--urdu');

  panel.appendChild(card);
  panel.appendChild(replayButton);
  layer.appendChild(panel);
  mount.appendChild(layer);

  // --- screen-reader announcement --------------------------------------

  // The full card, as one plain-text transcript. Strings are joined, never
  // rewritten; '. ' is the separator so a screen reader pauses between
  // lines instead of running them together.
  const A11Y_TEXT = [
    EYEBROW,
    c.intro,
    c.groom,
    c.groomParents,
    c.bride,
    c.brideParents,
    c.date,
    c.location,
  ].join('. ');

  // --- behaviour --------------------------------------------------------

  let visible = false;
  let hideTimer = 0;

  function handleReplay() {
    // Hiding here rather than leaving it to the caller keeps the control
    // honest on its own: the card is never left sitting over a restarted
    // sequence. Calling hide() again from the orchestrator is a no-op.
    api.hide();
    if (onReplay) onReplay();
  }

  replayButton.addEventListener('click', handleReplay);

  const api = {
    element: layer,
    replayButton,

    get visible() {
      return visible;
    },

    /** Fade the card in over 900 ms and narrate it. */
    show() {
      if (visible) return;
      visible = true;
      clearTimeout(hideTimer);

      layer.hidden = false;
      // Flush layout between `hidden = false` and adding the class, or the
      // browser coalesces both into one frame and the card simply appears.
      void layer.offsetWidth;
      layer.classList.add('invite-layer--in');

      // aria-live only fires on a change, and hide() clears this, so a
      // replay re-announces correctly.
      if (a11yTarget) a11yTarget.textContent = A11Y_TEXT;
    },

    /** Fade out, then take the layer out of the layout entirely. */
    hide() {
      if (!visible) return;
      visible = false;
      layer.classList.remove('invite-layer--in');
      if (a11yTarget) a11yTarget.textContent = '';

      clearTimeout(hideTimer);
      // A UI transition timer only — sequence timing is always driven from
      // the loop's accumulated elapsed, never from a timer.
      hideTimer = setTimeout(() => {
        layer.hidden = true;
      }, ENTER_MS);
    },

    dispose() {
      clearTimeout(hideTimer);
      replayButton.removeEventListener('click', handleReplay);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      visible = false;
    },
  };

  return api;
}
