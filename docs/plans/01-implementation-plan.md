# Implementation plan — nikkah announcement site

Target: `C:\Users\mdasj\Desktop\nikkah-invite`
Spec: `docs/specs/2026-08-25-nikkah-invite-design.md` — read it before Phase 1.
Storyboard reference (approved visual direction): Claude artifact
`https://claude.ai/code/artifact/09adb8b6-05f4-40d4-b23b-78e459cd4546`

Verified toolchain on this machine: Node v24.11.0, npm 11.6.1, git 2.45.1.

## How to execute this plan

Each phase is self-contained: it names the files it creates, the exact APIs it
may use, the behaviour it must produce, and a verification checklist that must
pass before moving on. Commit at the end of every phase.

**Standing rules for every phase**

1. **No invented APIs.** Only the surfaces listed in the Phase 0 allow-list may
   be called. If something outside it seems necessary, verify it exists first
   (MDN via WebFetch, or a one-line node/browser probe), then add it to the
   allow-list in this file with its source before using it.
2. **No new runtime dependencies.** `vite` and `vite-plugin-singlefile` are the
   only devDependencies. Zero runtime dependencies — no particle libraries, no
   animation libraries, no font packages.
3. **No blur, no glow, no radial-gradient blobs** anywhere in firework rendering.
   Sparks are crisp filled points plus short streaks. This was an explicit,
   repeated correction from the user.
4. **Do not paraphrase the invitation text.** Copy the strings verbatim from
   `src/config/content.js`, which is the single source of truth.
5. **Never block on a question.** If a small decision is genuinely undetermined,
   ask the user live via AskUserQuestion and continue in the same turn. Do not
   end the turn to ask.
6. **Verify before claiming.** Every "done" statement must be backed by a command
   that was actually run and whose output was read.

---

## Phase 0 — API discovery and allow-list

**Goal:** establish exactly which browser APIs are used, so no later phase
invents one. Nothing is implemented in this phase.

### Tasks

0.1 Confirm the local toolchain still matches: run `node --version`,
`npm --version`, `git --version`. Expect Node ≥ 20, npm ≥ 10, git ≥ 2.40.

0.2 Confirm the two devDependencies resolve before installing anything:
`npm view vite version` and `npm view vite-plugin-singlefile version`. Record
the resolved versions in this file under "Resolved versions" below.

0.3 Read the spec at `docs/specs/2026-08-25-nikkah-invite-design.md` in full.

0.4 If any API in the allow-list below is uncertain at point of use, verify with
`WebFetch` against the corresponding MDN page before writing the call.

### Allowed APIs

Canvas 2D — `CanvasRenderingContext2D`, obtained via
`canvas.getContext('2d', { alpha: false })`:

```
ctx.save() / restore() / translate(x,y) / scale(x,y) / rotate(rad)
ctx.clearRect / fillRect / beginPath / moveTo / lineTo / arc / quadraticCurveTo
ctx.bezierCurveTo / closePath / fill / stroke / ellipse
ctx.fillStyle / strokeStyle / lineWidth / lineCap / globalAlpha / globalCompositeOperation
ctx.createLinearGradient(x0,y0,x1,y1) -> gradient.addColorStop(stop, color)
ctx.font / textAlign / textBaseline / fillText / measureText
ctx.getImageData(x,y,w,h) -> ImageData { data: Uint8ClampedArray, width, height }
ctx.setTransform(a,b,c,d,e,f)
ctx.clip()                       // added in Phase 3 — see below
ctx.strokeText(text, x, y)       // added for the EXAMPLE stamp — see below
```

Added during Phase 3 under standing rule 1:

- `ctx.clip()` — Phase 3.3 specifies the cloud silhouette by clipping ("clip a
  rect covering the lower 48%… stroke the top edge path only… clipped to the
  shape"), but the API was missing from this list. Source: MDN
  `CanvasRenderingContext2D.clip()`
  (https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D/clip),
  baseline since the original Canvas 2D specification. Verified in the target
  browser before use: `typeof CanvasRenderingContext2D.prototype.clip ===
  'function'`, and a circular clip plus a full-canvas `fillRect` leaves the
  corner pixel at alpha 0 and the centre pixel at alpha 255. It is used only
  in `src/scene/clouds.js`, always inside a `save()`/`restore()` pair.

Added later, under the same rule:

- `ctx.strokeText()` — the EXAMPLE stamp on the loading screen outlines each
  letter in the night colour before filling it in gold, so it holds against
  both the dark box and the bright rocket underneath. Source: MDN
  `CanvasRenderingContext2D.strokeText()`
  (https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D/strokeText),
  baseline since the original Canvas 2D specification. Verified in the target
  browser before use: not merely that the property is a function, but that a
  stroked glyph actually paints — 712 non-transparent pixels from one
  `strokeText('E')` on a blank 120x60 canvas. Used only in `src/ui/loader.js`.

Notes that matter:
- `getImageData` on a canvas that has only ever been drawn to by same-origin
  code is not tainted — safe here, nothing external is drawn.
- Gradients are permitted **only** for sky, ground, rocket body and cloud fills.
  Never for sparks.

Offscreen text sampling — `document.createElement('canvas')` +
`ctx.fillText` + `ctx.getImageData`. `OffscreenCanvas` is **not** used
(Safari support history is uneven and there is no benefit here).

Web Audio — `AudioContext` (with `webkitAudioContext` fallback assignment):

```
new AudioContext()
ctx.state / ctx.resume() / ctx.currentTime / ctx.destination / ctx.sampleRate
ctx.createGain()          -> GainNode.gain (AudioParam)
ctx.createOscillator()    -> OscillatorNode.frequency, .type, .start(t), .stop(t)
ctx.createBufferSource()  -> AudioBufferSourceNode.buffer, .playbackRate, .start(t), .stop(t)
ctx.createBuffer(channels, length, sampleRate) -> AudioBuffer.getChannelData(n)
ctx.createBiquadFilter()  -> BiquadFilterNode.type, .frequency, .Q
AudioParam: .value, .setValueAtTime(v,t), .linearRampToValueAtTime(v,t),
            .exponentialRampToValueAtTime(v,t)   // v must be > 0
node.connect(dest) / node.disconnect()
```

Anti-patterns explicitly banned:
- `exponentialRampToValueAtTime(0, t)` — throws. Ramp to `0.0001` then
  `setValueAtTime(0, …)`.
- Creating an `AudioContext` before a user gesture — it starts `suspended`.
  Create it lazily on the first tap, then `await ctx.resume()`.
- Reusing an `OscillatorNode` or `AudioBufferSourceNode` after `.stop()` — they
  are one-shot. Create a new node per sound.

DOM / platform:

```
requestAnimationFrame(cb) / cancelAnimationFrame(id)
performance.now()
window.devicePixelRatio / innerWidth / innerHeight
window.addEventListener('resize' | 'orientationchange' | 'pointerdown' | 'keydown')
element.addEventListener('click' | 'pointerdown' | 'keydown')
document.visibilityState + 'visibilitychange'
window.matchMedia('(prefers-reduced-motion: reduce)') -> .matches
element.classList / setAttribute / textContent / style.setProperty
```

Banned in this project: `innerHTML` with interpolated content, `eval`,
`document.write`, `position: fixed` inside the artifact preview build,
`element.requestFullscreen`.

### Resolved versions

Fill these in during 0.2:

- vite: `8.2.2`
- vite-plugin-singlefile: `2.3.3`

### Verification

- [ ] Node/npm/git versions printed and recorded.
- [ ] Both package versions resolved and written above.
- [ ] Spec file read.

Commit: `chore: add design spec and implementation plan`

---

## Phase 1 — Scaffold

**Goal:** an empty but running Vite project with the exact file tree the later
phases expect.

### Files to create

```
nikkah-invite/
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
├── README.md
├── public/
│   └── favicon.svg
├── docs/
│   ├── specs/2026-08-25-nikkah-invite-design.md   (exists)
│   └── plans/01-implementation-plan.md            (exists)
└── src/
    ├── main.js
    ├── style.css
    ├── config/
    │   ├── content.js
    │   ├── palette.js
    │   └── timeline.js
    ├── engine/
    │   ├── loop.js
    │   ├── canvas.js
    │   ├── camera.js
    │   ├── rng.js
    │   └── easing.js
    ├── scene/
    │   ├── sky.js
    │   ├── ground.js
    │   ├── clouds.js
    │   ├── rocket.js
    │   └── setpiece.js
    ├── fx/
    │   ├── particles.js
    │   ├── burst.js
    │   ├── textPoints.js
    │   └── trail.js
    ├── audio/
    │   └── sound.js
    ├── ui/
    │   ├── prompt.js
    │   ├── muteToggle.js
    │   └── inviteCard.js
    └── sequence/
        └── director.js
```

### Task detail

1.1 `npm init -y`, then set `"type": "module"`, `"private": true`, name
`nikkah-invite`, scripts:
```json
"dev": "vite",
"build": "vite build",
"preview": "vite preview",
"build:single": "vite build --mode single"
```

1.2 `npm i -D vite vite-plugin-singlefile`

1.3 `vite.config.js` — base `'./'` (so the build works from any path, including
the artifact preview), and conditionally apply `viteSingleFile()` when
`mode === 'single'`:

```js
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    assetsInlineLimit: mode === 'single' ? 100000000 : 4096,
    cssCodeSplit: mode !== 'single',
  },
}));
```

1.4 `index.html` — `lang="en"`, `<meta name="viewport"
content="width=device-width, initial-scale=1, viewport-fit=cover">`, a
`<title>` of `Muhammad Asjad & Neha Kashif — Nikkah`, Open Graph tags (title,
description, type=website), the Google Fonts `<link>` for Cormorant Garamond
(600, 600 italic) and Jost (400, 500) with `display=swap`, and this body:

```html
<div id="stage">
  <canvas id="scene" aria-hidden="true"></canvas>
  <div id="ui"></div>
  <p id="a11y-text" class="sr-only" role="status" aria-live="polite"></p>
</div>
<noscript>…full invitation text as plain HTML…</noscript>
<script type="module" src="/src/main.js"></script>
```

The `<noscript>` block must contain the complete invitation so the page is
never a dead end.

1.5 `.gitignore`: `node_modules`, `dist`, `dist-single`, `.vite`, `.DS_Store`,
`*.local`.

1.6 `public/favicon.svg` — a small gold burst mark: a dark circle with 8 short
radiating gold strokes. Hand-authored SVG, under 1 KB.

1.7 All `src/**` files created as valid empty ES modules (`export {}` or a stub
export) so imports resolve from the start.

1.8 `git init`, then commit.

### Verification

- [ ] `npm run dev` starts and serves a blank dark page with no console errors.
- [ ] `npm run build` succeeds; `dist/index.html` exists.
- [ ] `npm run build:single` succeeds; `dist-single/index.html` exists and
      contains no `<script src=` or `<link rel="stylesheet" href=` pointing at a
      local file (confirm with grep — Google Fonts links are expected and fine).
- [ ] `git log --oneline` shows the commit.

Commit: `chore: scaffold vite project`

---

## Phase 2 — Config and engine core

**Goal:** deterministic, resolution-correct rendering primitives. No visible
scene yet beyond a cleared sky.

### 2.1 `src/config/content.js`

Single source of truth for every word on the page.

```js
export const CONTENT = {
  surprise: 'SURPRISE',
  lines: [
    'You are invited to the Nikkah ceremony',
    'of Muhammad Asjad, the beloved son of Ahmed Shemail and Munazzah Asif',
    'with Neha Kashif, the beloved daughter of Kashif Ali and Aisha Kashif',
  ],
  dateLine: 'January 1, 2027',
  locationLine: 'Location to be announced',
  card: {
    intro: 'You are invited to the Nikkah ceremony',
    groom: 'Muhammad Asjad',
    groomParents: 'beloved son of Ahmed Shemail & Munazzah Asif',
    bride: 'Neha Kashif',
    brideParents: 'beloved daughter of Kashif Ali & Aisha Kashif',
    date: 'January 1, 2027',
    location: 'Location to be announced',
  },
  prompt: 'Tap the fuse to light it',
  replay: 'Watch again',
};
```

### 2.2 `src/config/palette.js`

Export the palette table from the spec as a flat object of hex strings. Every
colour used anywhere in the app comes from here — no hex literals elsewhere in
`src/`, enforced by a grep in the final phase.

### 2.3 `src/config/timeline.js`

The 30-second schedule, in seconds from launch. This is the contract the
director implements:

| t (s) | Event |
|---|---|
| −∞ … 0 | Idle: ghost-match demo loops, prompt visible |
| 0.00 | Tap. Fuse ignites at the tip. |
| 0.00–1.40 | Fuse burns along its path toward the rocket base; hiss audio |
| 1.40 | Lift-off. Launch whoosh. Camera begins following. |
| 1.40–4.10 | Climb. Camera pans up; ground exits frame; passes 2 cloud banks |
| 4.10 | Big burst: boom + crackle. Sparks explode from screen centre. |
| 4.30–5.20 | `SURPRISE` resolves out of the flares |
| 5.20–7.60 | Hold; two small green/blue bursts flank it |
| 7.60–8.40 | Fade out |
| 8.60–13.60 | Line 1 (7 words), one small firework per word |
| 13.90–19.60 | Line 2 (12 words) |
| 19.90–25.60 | Line 3 (11 words) |
| 25.90–28.20 | Date + location, two bursts, gold |
| 28.20–29.20 | Sky quietens; a few ambient distant bursts |
| 29.00–30.00 | Invite card fades in over the sky; replay button appears |

Per-line internals: words appear left-to-right with a stagger of
`lineDuration / (wordCount + 2)`, each preceded by its own rising shell (0.35 s)
and burst. The line holds fully visible for at least 1.2 s before fading over
0.6 s.

Export as structured data (`{ t, kind, payload }[]` plus per-line stagger
helpers), not as hard-coded `setTimeout`s.

### 2.4 `src/engine/canvas.js`

- `setupCanvas(canvasEl)` → returns `{ ctx, resize, width, height, dpr }`.
- Backing store sized `cssW * dpr`, `cssH * dpr`, capped at `dpr = min(devicePixelRatio, 2)`
  to protect low-end phones.
- `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` after every resize so all drawing code
  works in CSS pixels.
- Debounced `resize` + `orientationchange` handler (100 ms) that re-runs layout
  and tells the scene to regenerate size-dependent geometry.

### 2.5 `src/engine/loop.js`

- `createLoop(update)` using `requestAnimationFrame`.
- Delta time clamped to `min(dt, 1/30)` so a background tab or a stall never
  teleports the simulation.
- Pauses on `document.visibilityState === 'hidden'`, resumes cleanly without
  jumping the clock (accumulate elapsed time explicitly, don't derive from
  wall-clock).
- Exposes `start()`, `stop()`, and `elapsed` (seconds since start).

### 2.6 `src/engine/camera.js`

- State: `{ y, zoom }` where `y` is world-space vertical offset in CSS pixels.
- `follow(targetY, dt)` with critically-damped smoothing so the rocket sits
  slightly below centre while climbing.
- `apply(ctx)` / `restore(ctx)` wrapping scene draws with `ctx.translate`.
- Clamped so the ground never reveals empty space below it.

### 2.7 `src/engine/rng.js`

Seeded PRNG (mulberry32). All scenery — star positions, grass blades, treeline,
cloud shapes — is generated from a fixed seed so the scene is identical on every
load and on every replay. Sparks use an unseeded stream so bursts feel alive.

### 2.8 `src/engine/easing.js`

`linear`, `easeOutCubic`, `easeInCubic`, `easeInOutCubic`, `easeOutBack`,
`easeOutQuint`. Pure functions, `t ∈ [0,1]`.

### Verification

- [ ] Page renders a full-viewport vertical sky gradient, no scrollbars, no
      letterboxing, on desktop and in a 375×812 mobile emulation.
- [ ] Resizing and rotating does not stretch or blur the canvas.
- [ ] `console` clean.
- [ ] Reloading twice produces an identical starfield (seeded RNG proof).

Commit: `feat: engine core, config, seeded rng`

---

## Phase 3 — Static night scene

**Goal:** the approved opening frame, rendered on canvas, at rest.

Everything here is drawn from the storyboard artifact. Match it.

### 3.1 `src/scene/sky.js`

- Vertical gradient `night-0 → night-1 (60%) → night-2 (100%)`.
- ~140 stars, seeded, in the upper 78% of the world; each has a phase and a
  period of 2.6–4.2 s; opacity oscillates 0.28 → 1.0.
- Stars are 1–2.4 px filled circles. No glow.
- The sky extends well above the initial viewport (world height ≈ 3.2 screens)
  so the camera has somewhere to climb.

### 3.2 `src/scene/ground.js`

- Ground band occupying the bottom 29% of the opening view.
- Fill: gradient `grass-hi → grass-mid (45%) → grass`.
- Four distant hills, `hill` colour, rounded tops, varying opacity 0.55–0.75,
  sitting just above the ground line.
- Treeline: ~64 conifer triangles, heights 22–62 px, widths 0.3 × height,
  alternating `tree` / `tree-2`, opacity 0.7–1.0, bases on the horizon so they
  rise into the sky.
- Grass: ~520 blades covering the **entire** ground band. Depth `d ∈ [0,1]` where
  `d = 0` is the horizon: `height = 4 + d*24`, `width = 1.2 + d*1.6`, opacity
  `0.35 + d*0.6`, lean `±14°`, colour `blade` when `d > 0.5` else `blade-lo`.
  Blades near the horizon must be short and faint; blades at the bottom tall and
  saturated.

### 3.3 `src/scene/clouds.js`

Clouds are **one continuous silhouette each** — this was an explicit correction;
overlapping circles are not acceptable.

Generation, per cloud of width `W`, height `H = 0.42W`:
- Walk `x` from 0 to `W`, emitting arc segments: radius
  `r = (0.09 + rand*0.09) * W * env + 7` where
  `env = 0.42 + 0.58 * sin(π * min(1, x/W + 0.06))` (bigger bumps in the middle);
  step `x += 2r * (0.78 + rand*0.30)`; each junction y is
  `baseY - (0.05H + rand*0.16H)`.
- Close the path down to a flat base to form one filled shape.
- Fill `cloud-mid`; clip a rect covering the lower 48% and fill it `cloud-lo`
  for the shaded underside; stroke the **top edge path only** with `cloud-hi` at
  3 px, clipped to the shape.
- Six banks at varying widths (150–320), opacities (0.6–0.92) and depths.
  Depth drives both parallax factor and z-order: some render behind the rocket,
  some in front. The pass-behind moment is intentional and must be preserved.

### 3.4 `src/scene/rocket.js`

Draw function taking `(ctx, x, y, scale, angle)`:
- Nose: filled triangle, `red-hi`, 22 px tall, 20 px base.
- Body: 20 × 54 px, horizontal gradient
  `red-lo → red (42%) → red-hi (60%) → red-lo` for a cylindrical read.
- Two gold bands, 4 px tall, at 10 px and 36 px from the body top.
- Fins: two `red-lo` triangles at the body base, 16 px tall, splaying 9 px out.
- Stick: 2.5 px wide, `#9c8a63`, below the body.
- All parts share one transform so the assembly never looks detached — this was
  a correction; draw it as one path group, not independently positioned pieces.

### 3.5 `src/scene/setpiece.js`

The idle interaction tableau:
- Rocket staked in the grass, slightly left of centre.
- Fuse: a bezier from the rocket **base** curving down and right, stroked
  `#cbbfa2` at 2.5 px, ending in a 9 px unlit grey tip.
- Pulsing ring on the fuse tip: 78 px diameter, 3 px `gold` stroke, 8% gold fill,
  1.8 s pulse (border brightens to `gold-hi`, an expanding 13 px halo ring fades out).
- Match at rest to the right: 66 × 8 px wooden stick rotated 24°, `red-lo` head,
  and a **lit flame on the match head** — 13 × 24 px teardrop, gradient
  `gold-hi → flame (55%) → red-hi`, flickering (rotate ±3°, scaleY 1.0–1.12,
  1.1 s). The fuse itself is never lit before the tap.
- Ghost demo, looping every 3.6 s: a 42–50% opacity copy of the match slides from
  rest to the fuse tip (offset ≈ −62 px, +26 px), holds ~0.65 s during which a
  small 14-spark flash plays at the tip, then fades while returning to rest.
- The whole set-piece scales down to 56% below 760 px viewport width so it fits a
  phone without clipping.

### 3.6 `src/ui/prompt.js`

- DOM element (not canvas) positioned just above the rocket, horizontally
  centred, `bottom: 41%` desktop / `30%` narrow.
- Gold-hi pill, `night-0` text, `font-size: clamp(14px, 2.1vw, 19px)`, Jost 500.
- Text from `CONTENT.prompt`.
- Hidden (`opacity` → 0, then `hidden`) the instant the sequence starts.

### Verification

- [ ] Side-by-side against the storyboard artifact frame 1 — grass covers the
      whole ground band, trees sit on the horizon at readable size, the fuse runs
      from the rocket base, the flame is on the match, the ring is on the fuse tip.
- [ ] The ghost match loop is visible and legible without reading the prompt.
- [ ] At 375 × 812 nothing overlaps or clips; the prompt does not cover the rocket.
- [ ] Steady 60 fps on desktop; ≥ 30 fps in a 4× CPU-throttled profile.

Commit: `feat: night scene, set-piece, idle prompt`

---

## Phase 4 — Synthesized audio

**Goal:** a self-contained sound layer with no asset files.

### 4.1 `src/audio/sound.js`

Public surface: `initAudio()`, `play(name, opts)`, `setMuted(bool)`,
`isMuted()`, `stopAll()`.

- `AudioContext` is created lazily inside `initAudio()`, which is called from the
  tap handler, then `await ctx.resume()`. Never before a gesture.
- A master `GainNode` → `destination`. Mute sets master gain via
  `linearRampToValueAtTime` over 80 ms (no clicks). Never disconnect.
- One reusable noise `AudioBuffer` (2 s of white noise at `ctx.sampleRate`),
  generated once; each noise-based sound is a fresh `AudioBufferSourceNode`
  reading from it with a random offset.

Sound recipes:

| Name | Construction |
|---|---|
| `fuse` | Looping noise source → bandpass ~2.8 kHz, Q 1.4 → gain 0.05, held while the fuse burns, ramped to silence at ignition |
| `launch` | Noise → bandpass sweeping 900 Hz → 260 Hz over 1.1 s, Q 2.2; gain 0.28 attack 40 ms, decay to 0.0001 by 1.2 s. Plus a sine at 180 Hz falling to 70 Hz, gain 0.10 |
| `boom` | Sine 92 Hz → 34 Hz over 0.5 s, gain 0.55 with 12 ms attack, exp decay to 0.0001 over 0.9 s; layered with noise → lowpass 420 Hz, gain 0.35, decay 0.55 s |
| `crackle` | 18–26 short noise grains scheduled over 1.1 s at randomized offsets; each 25–45 ms through a highpass at 3.2 kHz, gain 0.03–0.09 |
| `smallPop` | Sine 200 → 90 Hz over 0.2 s, gain 0.22; plus a 60 ms noise burst through highpass 2 kHz at gain 0.12. Pitch varies ±12% per call so repeats don't sound cloned |
| `shimmer` | Three detuned sines (1046, 1318, 1568 Hz) with 0.9 s exp decay, gain 0.05 each — used as each word resolves |
| `ambient` | Optional very low noise bed at gain 0.012, bandpass 300 Hz, started at launch, faded out with the card |

- Global polyphony cap of 24 concurrent voices; drop the oldest if exceeded.
- Every `stop()` scheduled explicitly so nodes get garbage-collected.
- If `AudioContext` is unavailable or construction throws, every call becomes a
  no-op and the visual sequence continues unaffected.

### 4.2 `src/ui/muteToggle.js`

- Fixed top-right button, 44 × 44 px minimum hit area (accessibility floor),
  gold outline on a translucent night ground.
- Two hand-authored SVG icons: speaker-on and speaker-off. No icon font.
- `aria-label` toggles between "Mute sound" and "Unmute sound"; `aria-pressed`
  reflects state. Visible focus ring.
- State persists in `sessionStorage` under `nikkah.muted` so a replay respects it.
- Visible from first paint — before the tap, not only after.

### Verification

- [ ] Tap → audio plays; no `AudioContext was not allowed to start` warning.
- [ ] Mute silences instantly with no click or pop; unmute restores.
- [ ] Rapid mute/unmute 10× leaves no stuck nodes (`ctx` node count stable).
- [ ] Works on iOS Safari behaviour model (context created in the gesture handler).
- [ ] With audio blocked entirely, visuals still run.

Commit: `feat: web audio synthesis and mute toggle`

---

## Phase 5 — Ignition, launch, camera follow

### 5.1 Input

- `#stage` handles `pointerdown` and `keydown` (Enter / Space) — the whole
  viewport is the target, not just the ring.
- Guard against double-fire (`if (state !== 'idle') return`).
- On fire: `initAudio()` → `play('fuse')` → hide prompt → start the director.

### 5.2 Fuse burn (0 → 1.4 s)

- The fuse bezier is sampled into ~60 points at setup. Burn progress `p` walks
  from the tip toward the rocket base; the consumed portion is not drawn, and a
  6–10 spark ember cluster rides the burn head with a short ash trail.
- The ring and ghost-match demo stop the moment the tap lands.

### 5.3 Lift-off (1.4 s)

- Rocket accelerates upward: `easeInCubic` for the first 0.35 s then near-linear,
  total climb ≈ 2.7 s, with a slight horizontal drift (±14 px sine).
- `src/fx/trail.js` emits, per frame:
  - **Exhaust flame** at the nozzle: 14 × 34 px teardrop, `gold-hi → flame →
    red-hi`, scaleY jittering 0.85–1.15.
  - **Embers**: 3–5 per frame, 1.2–3.8 px, colours gold-hi / flame / red-hi,
    initial velocity opposite the rocket plus lateral spread, gravity, life
    0.5–1.1 s, fading by opacity only.
  - **Smoke**: 1 puff every ~40 ms, radius growing 8 → 62 px over its 2.4 s life,
    colour `smoke` at starting alpha 0.30 → 0, drifting laterally.
  - Smoke renders **below** embers and flame; all three below the rocket sprite.

### 5.4 Camera

- Begins following at lift-off, keeping the rocket ~62% down the viewport.
- Critically damped (no overshoot, no visible spring).
- Cloud banks parallax by depth: far banks move at 0.35× camera, near at 1.15×.
- By burst time the ground is fully out of frame and the sky is the whole view.

### Verification

- [ ] Tap anywhere fires it — centre, corner, keyboard.
- [ ] Fuse visibly burns from the tip toward the rocket, then it launches.
- [ ] The rocket passes behind at least one cloud and in front of another.
- [ ] Camera motion is smooth with no jitter at 30 fps or 120 Hz.
- [ ] Trail reads as flame + embers + smoke, all emitted from the tail only.

Commit: `feat: ignition, launch, camera follow, exhaust trail`

---

## Phase 6 — Particle system and text-forming bursts

This is the heart of the project. Get it right before wiring the sequence.

### 6.1 `src/fx/particles.js`

- Pre-allocated pool (`MAX = 2600` desktop, `1400` when
  `matchMedia('(max-width: 760px)')` or `navigator.hardwareConcurrency <= 4`).
- Struct-of-arrays (`Float32Array` per field: x, y, vx, vy, life, maxLife, size,
  colorIndex, kind) — no per-particle object allocation, no GC churn.
- Integration per frame: `v *= drag^dt` (drag 0.86/s), `v.y += gravity*dt`
  (gravity 46 px/s²), `p += v*dt`, `life -= dt`.
- Render: for each live particle, a filled circle **plus** a streak — a 1.5 px
  line from `p - v*0.045` to `p`, alpha 0.26. Crisp. No blur, no shadowBlur, no
  gradient.
- Two draw passes: streaks first, then points, so points sit on top.

### 6.2 `src/fx/burst.js`

`emitBurst({ x, y, count, colors, speedMin, speedMax, size, spread })`

- Angles distributed evenly with ±0.07 rad jitter so the ring reads organic but
  not clumped.
- Vertical velocities scaled 0.82× for a slightly oblate, more natural shell.
- Optional `secondary`: 25% of particles spawn a 3–5 spark micro-burst at 60% of
  their life (the crackle effect).

### 6.3 `src/fx/textPoints.js` — the key mechanism

Sky text is **formed by the sparks**, not drawn as text with sparks nearby.

```
samplePoints(text, { font, maxWidth, density }) -> [{x, y}]
```

1. Create an offscreen canvas sized to fit the string at the requested font.
2. `ctx.font = '600 <size>px "Cormorant Garamond", Georgia, serif'` (italic for
   the sentence lines, upright + `letterSpacing` for `SURPRISE`).
3. `fillText` in white on transparent.
4. `getImageData`, then step the grid at `density` px (4–7 px depending on font
   size) and keep any sample whose alpha > 128.
5. Jitter each kept point by ±0.8 px so the glyph edge is not a machine-straight
   line of dots.
6. Return points in **radial order from the glyph centre** so the resolve
   animation reads as an outward bloom.

**Font-loading guard:** call `await document.fonts.ready` before the first
sample, and re-sample if `document.fonts.check('600 40px "Cormorant Garamond"')`
was false at sample time. Sampling before the webfont loads silently produces
Georgia-shaped text — a real and easy-to-miss bug.

Cache results per `(text, fontSize)` key; re-sample on resize.

### 6.4 Text resolve animation

For each target point:
- A spark is born at the burst origin with an outward velocity.
- Over `0.55–0.95 s` (staggered by radial index), it eases from ballistic motion
  toward its target point using `easeOutQuint` on a lerp factor, so flares appear
  to fly out and settle into the letterform.
- On arrival it becomes a stationary "letter spark" with a slow twinkle.
- The assembled word holds, then disperses: gravity is restored, sparks drift
  down and fade over 0.6 s.

Letter sparks get the fine dotted texture read by using two sizes (1.6 px and
2.6 px) alternating along the glyph.

### 6.5 Line layout

`layoutLine(words, viewport)`:
- Measures each word at the target font size.
- Packs words into rows that fit `viewport.width * 0.88`, with 1–3 rows depending
  on width and word count. Long lines (12–13 words) become 2 rows on desktop,
  3–4 on a phone.
- Within a row, words get a jittered vertical offset (±6% of viewport height) so
  the result looks like fireworks at different altitudes, not a typeset line.
- Font size: `clamp(18px, 4.6vw, 46px)`, scaled so the widest row always fits.
- Guarantee: no word is ever clipped by the viewport at 320 px width.

### Verification

- [ ] `SURPRISE` visibly assembles out of flying sparks — record and step through.
- [ ] Text is legible at 320 px, 375 px, 768 px, 1440 px and 2560 px widths.
- [ ] Zero allocations per frame in a DevTools memory profile during a burst.
- [ ] ≥ 30 fps at 4× CPU throttle with the 12-word line on screen.
- [ ] No blur, no `shadowBlur`, no radial gradients — grep `src/fx` to confirm.
- [ ] Text sampled after fonts are ready (test by throttling to Slow 3G).

Commit: `feat: particle system, bursts, text-forming sparks`

---

## Phase 7 — The director

### 7.1 `src/sequence/director.js`

- A state machine over the Phase 2.3 timeline: `idle → fuse → launch → surprise
  → line1 → line2 → line3 → dateline → settle → card`.
- Driven by the loop's `elapsed`, not by `setTimeout`, so a paused tab resumes
  correctly and the audio stays in step.
- Each line: for every word, schedule `[shellLaunch → burst + smallPop → resolve
  → shimmer]` at its stagger offset. Shells rise from off the bottom of the
  frame so the bursts have visible causes.
- Colour assignment per word cycles gold-hi / white-spark / green / blue, seeded
  per line so it is stable across replays.
- Between lines, 2–4 ambient distant bursts at low alpha and small radius keep
  the sky alive during the gaps.
- `SURPRISE` uses gold + white only, at roughly 2.2× the word-burst particle
  count, flanked by one green and one blue burst.
- Total runtime must land within 30 s ± 0.5 s; assert this in a unit-style check
  that sums the schedule.

### Verification

- [ ] Full watch-through: every one of the three lines plus the date appears,
      complete and correctly spelled, in order.
- [ ] Timed with a stopwatch: 30 s ± 1 s from tap to card.
- [ ] Switch tabs mid-sequence and return — no desync, no skipped line.
- [ ] Audio events land on their visual beats.

Commit: `feat: sequence director`

---

## Phase 8 — Invite card and replay

### 8.1 `src/ui/inviteCard.js`

- Real DOM, not canvas — text must be selectable, zoomable and screen-reader
  readable.
- Parchment card (`card-bg`) floating over the still-visible night sky, centred,
  `max-width: 30rem`, generous padding, 12 px radius, a hairline `rule` border,
  and a soft dark scrim behind it (a plain `rgba(6,9,22,0.45)` layer — solid
  colour, not a blur) so the text holds against the sky.
- Content from `CONTENT.card`, laid out exactly as the approved storyboard:
  eyebrow "Nikkah" → intro line → groom name → groom parents → rule → bride name
  → bride parents → rule → date → location.
- Type: Cormorant Garamond 600 for the intro heading, 600 italic for the two
  names, Jost 400 for the parent and meta lines. Sizes
  `clamp(26px, 5.2vw, 34px)` heading, `clamp(20px, 4.4vw, 26px)` names,
  `clamp(13px, 3.2vw, 15px)` meta.
- Entrance: opacity 0 → 1 and `translateY(14px) → 0` over 900 ms, `easeOutCubic`.
- `#a11y-text` receives the full invitation as plain text when the card appears,
  so a screen reader announces it.

### 8.2 Replay

- "Watch again" button beneath the card: 44 px min height, gold-hi fill,
  `night-0` text, visible focus ring.
- Resets particles, camera, scene state and the director to `idle`, restores the
  set-piece and prompt, and preserves the mute setting.
- Must be replayable indefinitely with no leak: particle pool length constant,
  audio node count stable, no growing listener count.

### Verification

- [ ] Card text is selectable and matches the spec verbatim, character for character.
- [ ] Sky remains visible behind the card.
- [ ] Replay 5× in a row — identical result each time, memory flat in a heap profile.
- [ ] Card is fully readable at 320 px width without horizontal scroll.

Commit: `feat: invite card and replay`

---

## Phase 9 — Responsive, accessibility, performance, resilience

### 9.1 Responsive

Test and fix at: 320×568, 375×812, 390×844, 414×896, 768×1024, 1024×768,
1280×800, 1440×900, 2560×1440. Portrait and landscape.

- Set-piece scale, prompt position, text sizes and line packing all adapt.
- `100dvh` with a `100vh` fallback so mobile browser chrome doesn't clip the scene.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the UI layer for
  notched phones.
- Rotating mid-sequence must not break layout — re-layout on `orientationchange`.

### 9.2 Accessibility

- `prefers-reduced-motion: reduce`: skip the flight and burst choreography; show
  a calm starfield, fade the invitation lines in as plain text in sequence over
  ~8 s, then the card. Same content, no violent motion.
- All interactive elements keyboard reachable with a visible focus ring.
- Colour contrast on the card ≥ 7:1 (`#241d10` on `#fbf6e9` clears this
  comfortably); the prompt pill ≥ 7:1.
- `aria-live="polite"` status element narrates each line as it appears.
- Canvas is `aria-hidden="true"` — it carries no information not also in the DOM.
- The `<noscript>` invitation must be complete and styled legibly.

### 9.3 Performance

- Budget: first contentful paint < 1.5 s on a throttled 4G connection; total
  transferred (excluding fonts) < 120 KB; ≥ 30 fps at 4× CPU throttle throughout.
- Particle cap auto-lowers on low-core devices.
- Cap `devicePixelRatio` at 2.
- Preconnect to `fonts.googleapis.com` and `fonts.gstatic.com`; `display=swap`.
- Consider self-hosting the two font files if the fetch proves slow — only if the
  budget is missed.

### 9.4 Resilience

- Fonts fail to load → Georgia / system-ui fallbacks, sampled text still works.
- Web Audio unavailable → silent, visuals unaffected.
- `getImageData` throws → fall back to drawing the line as plain canvas text with
  a burst behind it; the sequence must never stall.
- Any uncaught error in the director → catch, log, and jump straight to the card
  so no visitor is left staring at a frozen sky. This is the most important
  failure mode: **the invitation must always arrive.**

### Verification

- [ ] Every listed viewport checked; screenshots taken at 375×812 and 1440×900.
- [ ] Reduced-motion path delivers all content.
- [ ] Keyboard-only run-through works end to end.
- [ ] Artificially throw inside the director → card still appears.
- [ ] Lighthouse: performance ≥ 90, accessibility ≥ 95 on mobile emulation.

Commit: `feat: responsive, a11y, performance, error resilience`

---

## Phase 10 — Preview, docs, deployment prep

### 10.1 Build the single-file preview and publish it to Claude

**This step is required. The user is waiting to see it.**

1. `npm run build:single` → `dist-single/index.html`.
2. Confirm it is genuinely self-contained: no local `src=` / `href=` references
   remain (Google Fonts links are permitted — the artifact CSP allows
   `fonts.googleapis.com` and `fonts.gstatic.com`, and nothing else).
3. Copy it to the scratchpad, then publish with the `Artifact` tool:
   - `title`: `Asjad & Neha Nikkah`
   - `favicon`: `🎆`
   - `description`: one sentence describing the announcement experience.
4. Give the user the artifact URL in the reply, and say plainly what to tap.
5. Before publishing, open the built file in the browser pane and confirm it
   actually runs — do not publish an unverified build.

Note: the artifact renders inside an iframe, so `position: fixed` is unreliable
there. Use absolutely-positioned UI inside a `position: relative` stage that
fills `100dvh`; this works identically in both the artifact and the real site.

### 10.2 README

Cover: what the site is, `npm install` / `dev` / `build`, where to change the
location placeholder (`src/config/content.js`), where to change the date, how to
deploy to Vercel, and a short note that all audio is synthesized so there are no
asset licences to worry about.

### 10.3 Deployment prep

- `vercel.json` with a static build config and a catch-all rewrite to `/`.
- Confirm `dist/` output works when served from a subpath (base `'./'` already
  handles this, which also keeps GitHub Pages viable).
- Do **not** create a GitHub remote or push. Leave the repo clean with all phases
  committed and print the exact commands the user would run to publish it.

### 10.4 Final audit

Run these and paste real output:

```bash
npm run build
grep -rn "#[0-9a-fA-F]\{6\}" src --include=*.js | grep -v "config/palette.js"   # expect no hits
grep -rn "shadowBlur\|filter:\s*blur\|createRadialGradient" src                  # expect no hits
grep -rn "innerHTML" src                                                         # expect no hits
grep -rn "TODO\|FIXME\|XXX" src                                                  # expect no hits
git status --porcelain                                                           # expect clean
git log --oneline
```

Then re-read `docs/specs/2026-08-25-nikkah-invite-design.md` and confirm every
"Decisions" row is honoured in the built site.

### Verification

- [ ] Artifact published and its URL given to the user.
- [ ] The published artifact was opened and the full sequence watched through.
- [ ] All four greps return nothing.
- [ ] `git status` clean, every phase committed.
- [ ] README accurate.

Commit: `docs: readme and deployment config`

---

## Anti-pattern guards (re-read before each phase)

| Do not | Instead |
|---|---|
| Draw sparks with `shadowBlur` or radial gradients | Filled circles + 1.5 px streaks |
| Build clouds from overlapping circles | One merged-arc silhouette per cloud |
| Put the flame on the fuse before the tap | Flame on the match head only |
| Draw sky text as `fillText` with sparks nearby | Sample glyph points; sparks fly to them |
| Use a script font for sky text | Cormorant Garamond — elderly viewers must read it |
| Allocate objects per particle per frame | Pre-allocated typed-array pool |
| Drive the sequence with `setTimeout` | Drive from the loop's accumulated `elapsed` |
| Sample text before webfonts load | `await document.fonts.ready` first |
| `exponentialRampToValueAtTime(0, t)` | Ramp to `0.0001`, then `setValueAtTime(0, t)` |
| Create `AudioContext` at module load | Create it inside the tap handler |
| Hardcode hex colours outside `palette.js` | Import from `palette.js` |
| Let an error freeze the sky | Catch and jump to the card |
| End the turn to ask a small question | Ask live with AskUserQuestion, keep working |
| Claim a phase is done without running its checks | Run them, read the output, then claim |
