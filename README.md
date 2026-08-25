# Nikkah announcement

A single-page invitation. You open the link, light a firework, and it climbs
into the night sky and bursts into the announcement, one line at a time, before
settling into a card you can read and share.

Built for phones first, and for viewers who are not comfortable with
technology: there is one thing to do on the screen, it is signposted three ways
(a pulsing ring on the fuse, a match that repeatedly drifts in to demonstrate
the tap, and a plain-language label), and tapping anywhere at all works.

## Running it

```bash
npm install
```

```bash
npm run dev
```

Then open the URL it prints. Other scripts:

| Script | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run build:single` | One self-contained HTML file in `dist-single/` |

## Changing the details

Every word on the site comes from one file: **`src/config/content.js`**.
Nothing else needs editing.

- **Location** — replace `Location to be announced` in both `locationLine` and
  `card.location`.
- **Date** — replace `January 1, 2027` in both `dateLine` and `card.date`.
- **Names** — the `lines` array drives the firework text; the `card` object
  drives the final card. Keep them consistent with each other.

The sequence adapts automatically: line lengths, word counts and the resulting
firework choreography are all derived from these strings, so a longer or
shorter line still fits and still lands inside the 30 seconds.

Colours live in `src/config/palette.js`, and the 30-second schedule in
`src/config/timeline.js`.

## Deploying

The build is entirely static. On **Vercel**, import the repository and accept
the detected settings (build `npm run build`, output `dist`) — `vercel.json`
already pins them. Netlify and GitHub Pages work too; `base` is `'./'`, so the
build runs correctly from a subpath as well as from a domain root.

## Notes worth knowing

**There are no audio files.** Every sound — the fuse hiss, the launch, the
boom, the crackle, the small pops — is synthesized in the browser with the Web
Audio API. Nothing to download, nothing to license, and the whole site is well
under 100 KB. Sound starts on the tap (browsers require a gesture) and there is
a mute button in the corner from the first frame.

**It degrades honestly.** If the webfonts fail, it falls back to a serif. If
audio is blocked, it plays silently. If anything throws mid-sequence, it jumps
straight to the invitation card rather than freezing — the invitation always
arrives. With JavaScript off entirely, the `<noscript>` block still carries the
full text.

**Reduced motion is respected.** A viewer whose system asks for less animation
gets the same words, faded in calmly over a still scene, with no flight and no
bursts.

## Layout of the source

```
src/
  config/     content, palette, and the 30-second timeline
  engine/     canvas sizing, render loop, camera, seeded RNG, easing
  scene/      sky, ground, clouds, rocket, and the interactive set-piece
  fx/         particle pool, bursts, the text-forming sparks, exhaust trail
  audio/      Web Audio synthesis
  ui/         prompt, mute toggle, invite card
  sequence/   the director that runs the show
```

The one idea worth understanding: **the sky text is made of the sparks**. Each
word is rendered offscreen, its pixels sampled into a point cloud, and every
spark from the burst flies to one of those points and stays there. The letters
are not drawn — they are where the flares landed.

Design notes and the build plan are in `docs/`.
