/**
 * The opening screen.
 *
 * Two jobs, and the second is the reason it exists. It teaches the one
 * interaction the site has — a match coming down onto a fuse — on a screen
 * with nothing else to look at. And it holds the page on a deliberate tap
 * rather than dropping the viewer straight into a scene that a slower phone
 * may still be assembling, so nobody meets a half-drawn meadow.
 *
 * The demonstration used to live in the meadow itself, beside the two real
 * fireworks, where it read as an instruction to pick the one it stood next
 * to. Alone on its own screen and labelled EXAMPLE, it can only be read as
 * what it is.
 *
 * Decor is canvas: a slow drift of embers and a low arc of distant shells, so
 * the screen belongs to the same night as the scene behind it rather than
 * being a black rectangle with text on it.
 */

import { PALETTE } from '../config/palette.js';
import { CONTENT_EN, CONTENT_UR } from '../config/content.js';
import { drawDemoTableau } from '../scene/demoTableau.js';
import { createRng, SEEDS } from '../engine/rng.js';

const TAU = Math.PI * 2;

/** Drifting embers behind everything. */
const EMBER_COUNT = 46;

/** Slow shells arcing across the lower half. */
const SHELL_COUNT = 5;

function makeEl(tag, className, text, lang, dir) {
  const el = document.createElement(tag);
  el.className = className;
  if (text) el.textContent = text;
  if (lang) el.lang = lang;
  if (dir) el.dir = dir;
  return el;
}

/**
 * Build the loading screen.
 *
 * @param {HTMLElement} host
 * @param {{ onContinue?: () => void }} [options]
 * @returns {{ el: HTMLElement, dismiss: () => void, dispose: () => void }}
 */
export function createLoader(host, options = {}) {
  const onContinue = typeof options.onContinue === 'function' ? options.onContinue : null;

  const el = document.createElement('div');
  el.className = 'loader';

  const canvas = document.createElement('canvas');
  canvas.className = 'loader-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  el.appendChild(canvas);

  const panel = makeEl('div', 'loader-panel');

  const heading = makeEl('div', 'loader-heading');
  heading.appendChild(makeEl('span', 'loader-line', CONTENT_EN.chooser, 'en', 'ltr'));
  heading.appendChild(
    makeEl('span', 'loader-line loader-line--urdu', CONTENT_UR.chooser, 'ur', 'rtl')
  );
  panel.appendChild(heading);

  // The tableau's canvas is the element the demo is drawn into; the heading
  // sits above it and the call to action below, so the whole group is one
  // centred column at any aspect ratio.
  const demoSlot = makeEl('div', 'loader-demo');
  panel.appendChild(demoSlot);

  const cta = makeEl('div', 'loader-cta');
  cta.appendChild(makeEl('span', 'loader-cta-line', 'Tap to continue', 'en', 'ltr'));
  cta.appendChild(
    makeEl('span', 'loader-cta-line loader-cta-line--urdu', 'جاری رکھنے کے لیے دبائیں', 'ur', 'rtl')
  );
  panel.appendChild(cta);

  el.appendChild(panel);
  host.appendChild(el);

  // --- canvas -------------------------------------------------------------

  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;
  let embers = [];
  let shells = [];

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = el.clientWidth || window.innerWidth;
    height = el.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rng = createRng(SEEDS.scenery);
    embers = [];
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      embers.push({
        x: rng.next() * width,
        y: rng.next() * height,
        r: 0.7 + rng.next() * 1.9,
        speed: 5 + rng.next() * 16,
        drift: rng.range(-6, 6),
        phase: rng.next() * TAU,
        colour: i % 3 === 0 ? PALETTE.whiteSpark : PALETTE.goldHi,
      });
    }
    shells = [];
    for (let i = 0; i < SHELL_COUNT; i += 1) {
      shells.push({
        x: width * (0.1 + rng.next() * 0.8),
        y: height * (0.62 + rng.next() * 0.3),
        r: 12 + rng.next() * 26,
        period: 5 + rng.next() * 5,
        offset: rng.next() * 10,
        colour: [PALETTE.goldHi, PALETTE.green, PALETTE.blue, PALETTE.whiteSpark][i % 4],
      });
    }
  }

  function drawDecor(t) {
    // Embers rising, wrapping at the top.
    for (const e of embers) {
      const y = ((e.y - t * e.speed) % (height + 40) + height + 40) % (height + 40) - 20;
      const x = e.x + Math.sin(t * 0.4 + e.phase) * e.drift;
      ctx.globalAlpha = 0.16 + 0.24 * (0.5 + 0.5 * Math.sin(t * 1.4 + e.phase));
      ctx.fillStyle = e.colour;
      ctx.beginPath();
      ctx.arc(x, y, e.r, 0, TAU);
      ctx.fill();
    }

    // Distant shells, opening and fading low on the screen.
    for (const s of shells) {
      const u = ((t + s.offset) % s.period) / s.period;
      if (u > 0.55) continue;
      const k = u / 0.55;
      const radius = s.r * (0.2 + k * 0.8);
      ctx.globalAlpha = (1 - k) * 0.28;
      ctx.fillStyle = s.colour;
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        ctx.beginPath();
        ctx.arc(s.x + Math.cos(a) * radius, s.y + Math.sin(a) * radius * 0.8, 1.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  let raf = 0;
  let start = 0;
  let running = true;

  function frame(now) {
    if (!running) return;
    if (!start) start = now;
    const t = (now - start) / 1000;

    ctx.clearRect(0, 0, width, height);
    drawDecor(t);

    // The tableau, centred on the slot the layout reserved for it. Reading
    // the slot's own box is what keeps it centred on a tall phone and a wide
    // monitor alike — there is no viewport maths here to get wrong.
    const slot = demoSlot.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    const cx = slot.left - host.left + slot.width / 2;
    const cy = slot.top - host.top + slot.height / 2;
    const s = Math.max(0.75, Math.min(1.9, slot.width / 210));
    drawDemoTableau(ctx, cx, cy, s, t, {
      caption: 'EXAMPLE',
      captionFont: `500 ${Math.round(13 / s)}px Jost, system-ui, sans-serif`,
    });

    raf = requestAnimationFrame(frame);
  }

  layout();
  raf = requestAnimationFrame(frame);

  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  let dismissed = false;

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    running = false;
    cancelAnimationFrame(raf);
    el.classList.add('loader--out');
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    setTimeout(() => {
      el.hidden = true;
    }, 420);
    // Arm on a timer, not in this event: anything still travelling from this
    // same press — the keydown path especially, where both this screen and the
    // scene listen on window — must find the scene still closed.
    //
    // Deliberately setTimeout and NOT requestAnimationFrame. A frame callback
    // never fires while the tab is hidden, so a page opened in a background
    // tab would arm only once someone looked at it, and until then every tap
    // did nothing at all.
    if (onContinue) setTimeout(onContinue, 0);
  }

  function onKey(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      dismiss();
    }
  }

  // Swallow the dismissing tap. The stage behind this overlay is itself one
  // big ignition target, so without this the same press that clears the
  // loading screen carries on through and lights a firework the viewer never
  // saw — choosing their language for them.
  el.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    event.preventDefault();
    dismiss();
  });
  window.addEventListener('keydown', onKey);

  return {
    el,
    get dismissed() {
      return dismissed;
    },
    dismiss,
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('keydown', onKey);
      if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
