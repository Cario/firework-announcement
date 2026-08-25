/**
 * Always-visible mute button with hand-authored SVG icons.
 *
 * Phase 4.2:
 * - Top-right, 44 x 44 px minimum hit area, gold outline on a translucent
 *   night ground. Positioned absolutely inside the stage rather than `fixed`,
 *   because `position: fixed` is unreliable in the artifact preview iframe.
 * - Two hand-authored inline SVG icons — speaker-on and speaker-off. No icon
 *   font, and no innerHTML: every node is built with createElementNS.
 * - `aria-label` toggles between "Mute sound" and "Unmute sound";
 *   `aria-pressed` reflects the muted state; the focus ring stays visible.
 * - State persists in sessionStorage under `nikkah.muted`, so a replay — or a
 *   reload within the same tab session — respects the visitor's choice.
 * - Mounted at boot, so it is on screen from the first paint, before the tap.
 */

import { setMuted, isMuted } from '../audio/sound.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'nikkah.muted';

const LABEL_WILL_MUTE = 'Mute sound';
const LABEL_WILL_UNMUTE = 'Unmute sound';

/* ---------------------------------------------------------------
   Persistence — sessionStorage throws in some privacy modes.
   --------------------------------------------------------------- */

function readStoredMuted() {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch (err) {
    return false;
  }
}

function writeStoredMuted(value) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch (err) {
    /* storage unavailable; the toggle still works for this page view */
  }
}

/* ---------------------------------------------------------------
   Icons — hand-authored on a 24 x 24 grid.
   --------------------------------------------------------------- */

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  const keys = Object.keys(attrs);
  for (let i = 0; i < keys.length; i += 1) {
    el.setAttribute(keys[i], attrs[keys[i]]);
  }
  return el;
}

function iconShell(className) {
  const svg = svgEl('svg', {
    class: className,
    viewBox: '0 0 24 24',
    width: '22',
    height: '22',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.7',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  // Speaker body: back plate, then the cone opening out to the right.
  svg.appendChild(
    svgEl('path', {
      d: 'M3.6 9.3 H7.3 L11.9 5.2 V18.8 L7.3 14.7 H3.6 Z',
      fill: 'currentColor',
    })
  );
  return svg;
}

function speakerOnIcon() {
  const svg = iconShell('mute-toggle__icon mute-toggle__icon--on');
  // Two sound arcs, drawn as arc segments rather than circles.
  svg.appendChild(svgEl('path', { d: 'M14.9 9.2 a4.1 4.1 0 0 1 0 5.6' }));
  svg.appendChild(svgEl('path', { d: 'M17.4 6.6 a7.9 7.9 0 0 1 0 10.8' }));
  return svg;
}

function speakerOffIcon() {
  const svg = iconShell('mute-toggle__icon mute-toggle__icon--off');
  // A cross where the arcs would be.
  svg.appendChild(svgEl('path', { d: 'M15.4 9.6 L20.2 14.4', 'stroke-width': '1.9' }));
  svg.appendChild(svgEl('path', { d: 'M20.2 9.6 L15.4 14.4', 'stroke-width': '1.9' }));
  return svg;
}

/* ---------------------------------------------------------------
   Factory
   --------------------------------------------------------------- */

/**
 * Build and mount the mute toggle.
 *
 * @param {HTMLElement | { mount?: HTMLElement, onChange?: (muted: boolean) => void }} [arg]
 *        Either the element to mount into, or an options object.
 * @returns {{ el: HTMLButtonElement, isMuted: () => boolean,
 *             setMuted: (muted: boolean) => void, destroy: () => void }}
 */
export function createMuteToggle(arg) {
  const options = arg && arg.nodeType === 1 ? { mount: arg } : arg || {};
  const mount =
    options.mount || document.getElementById('ui') || document.body;
  const onChange = typeof options.onChange === 'function' ? options.onChange : null;

  let muted = readStoredMuted();

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mute-toggle';
  button.appendChild(speakerOnIcon());
  button.appendChild(speakerOffIcon());

  function render() {
    const label = muted ? LABEL_WILL_UNMUTE : LABEL_WILL_MUTE;
    button.setAttribute('aria-pressed', muted ? 'true' : 'false');
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function apply(next, persist) {
    muted = Boolean(next);
    render();
    setMuted(muted);
    if (persist) writeStoredMuted(muted);
    if (onChange) onChange(muted);
  }

  function onClick() {
    apply(!muted, true);
  }

  // The whole viewport is the ignition target, so the button must not let its
  // own pointer / key events reach the stage handler behind it.
  function swallowPointer(event) {
    event.stopPropagation();
  }

  function swallowKey(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.stopPropagation();
    }
  }

  button.addEventListener('click', onClick);
  button.addEventListener('pointerdown', swallowPointer);
  button.addEventListener('keydown', swallowKey);

  // Sync the audio layer with the restored state before anything can play.
  apply(muted, false);
  mount.appendChild(button);

  return {
    el: button,
    isMuted: () => muted,
    setMuted: (next) => apply(next, true),
    destroy() {
      button.removeEventListener('click', onClick);
      button.removeEventListener('pointerdown', swallowPointer);
      button.removeEventListener('keydown', swallowKey);
      if (button.parentNode) button.parentNode.removeChild(button);
    },
  };
}

/** Re-exported so callers can read the layer's state without a second import. */
export { isMuted };

export default createMuteToggle;
