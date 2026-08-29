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

/**
 * Shells opening behind the text.
 *
 * Sized off the viewport, not off a fixed pixel radius: at 12-38px they read
 * as specks on a phone and as dust on a monitor. A real shell fills a good
 * part of the sky, so these are a fraction of the screen's smaller dimension
 * and land somewhere between a third and two thirds of it across.
 */
const SHELL_COUNT = 7;
const SHELL_MIN_SPAN = 0.3;
const SHELL_MAX_SPAN = 0.62;

/** Sparks per shell. A big shell needs a full ring or it looks like a dotted circle. */
const SHELL_SPARKS = 26;

/** Tilt of the EXAMPLE stamp across the demo box, radians. */
const STAMP_ANGLE = 20 * (Math.PI / 180);

/**
 * A rounded-rectangle path.
 *
 * Built from lineTo and quadraticCurveTo rather than ctx.roundRect, whose
 * support is still uneven, and which is not on this project's API list.
 */
function roundedRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

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
    const span = Math.min(width, height);
    for (let i = 0; i < SHELL_COUNT; i += 1) {
      shells.push({
        x: width * (0.08 + rng.next() * 0.84),
        // Spread over the whole screen rather than hugging the bottom: these
        // are the backdrop the text sits against, not a footer.
        y: height * (0.12 + rng.next() * 0.78),
        r: span * (SHELL_MIN_SPAN + rng.next() * (SHELL_MAX_SPAN - SHELL_MIN_SPAN)) * 0.5,
        period: 5 + rng.next() * 5,
        offset: rng.next() * 12,
        tilt: rng.range(-0.4, 0.4),
        colour: [PALETTE.goldHi, PALETTE.green, PALETTE.blue, PALETTE.whiteSpark, PALETTE.flame][i % 5],
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
      if (u > 0.6) continue;
      const k = u / 0.6;
      // Eases out, so it opens fast and then hangs, the way a shell does.
      const spread = 1 - (1 - k) * (1 - k);
      const radius = s.r * (0.12 + spread * 0.88);
      const fade = (1 - k) * 0.34;
      ctx.fillStyle = s.colour;
      ctx.strokeStyle = s.colour;
      for (let i = 0; i < SHELL_SPARKS; i += 1) {
        const a = (i / SHELL_SPARKS) * TAU + s.tilt;
        const px = s.x + Math.cos(a) * radius;
        const py = s.y + Math.sin(a) * radius * 0.82;

        // A short trailing streak behind each spark, which is what stops a big
        // ring reading as a circle of dots.
        ctx.globalAlpha = fade * 0.45;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(s.x + Math.cos(a) * radius * 0.74, s.y + Math.sin(a) * radius * 0.82 * 0.74);
        ctx.lineTo(px, py);
        ctx.stroke();

        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.arc(px, py, 2.1, 0, TAU);
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
    const hostBox = el.getBoundingClientRect();
    const bx = slot.left - hostBox.left;
    const by = slot.top - hostBox.top;
    const cx = bx + slot.width / 2;
    const cy = by + slot.height / 2;
    // Fit the box on BOTH axes. Sizing off the width alone was enough on a
    // tall phone and wrong everywhere else: on a short or landscape viewport
    // the box loses height while keeping its width, and the firework was
    // drawn at full size into a box too shallow to hold it, so the clip cut
    // the nose off. 115 is the tableau's own vertical extent in local units.
    const s = Math.max(0.55, Math.min(1.9, slot.width / 175, slot.height / 115));

    // --- the frame -------------------------------------------------------
    // A box around the demonstration, so it reads as a diagram OF the thing
    // rather than as part of the page. Darker inside than the screen behind
    // it, with a gold hairline — the same vocabulary the rest of the site
    // uses for something you are meant to look at.
    ctx.save();
    roundedRectPath(ctx, bx, by, slot.width, slot.height, 14);
    ctx.fillStyle = 'rgba(6, 11, 28, 0.62)';
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = PALETTE.gold;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Everything below is clipped to the box, so the match cannot swing out
    // of the frame on its way in.
    ctx.clip();
    drawDemoTableau(ctx, cx, cy, s, t, {});

    // --- the stamp -------------------------------------------------------
    // Rotated across the whole box: translucent enough to read the diagram
    // through, heavy enough to be the first thing seen. This replaces the
    // caption that used to sit above the rocket — one EXAMPLE, not two.
    ctx.translate(cx, cy);
    ctx.rotate(-STAMP_ANGLE);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    const stampSize = Math.min(slot.width, slot.height) * 0.34;
    ctx.font = `600 ${stampSize}px Jost, system-ui, sans-serif`;

    // Tracked out by hand: a stamp reads as a stamp because of the air
    // between its letters, and canvas letter-spacing is not available here.
    const stamp = 'EXAMPLE';
    const tracking = stampSize * 0.18;
    let total = 0;
    for (const ch of stamp) total += ctx.measureText(ch).width + tracking;
    total -= tracking;
    const fit = Math.min(1, (Math.hypot(slot.width, slot.height) * 0.8) / total);
    let pen = (-total * fit) / 2;
    for (const ch of stamp) {
      const w = ctx.measureText(ch).width * fit;
      ctx.save();
      ctx.translate(pen + w / 2, 0);
      ctx.scale(fit, fit);
      // A dark outline first, so the gold holds against the bright rocket
      // as well as against the dark box.
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = stampSize * 0.1;
      ctx.strokeStyle = PALETTE.night0;
      ctx.strokeText(ch, 0, 0);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = PALETTE.goldHi;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      pen += w + tracking * fit;
    }
    ctx.globalAlpha = 1;
    ctx.restore();

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
