# Nikkah invitation

A single-page announcement site. A visitor taps a fuse, watches a firework climb
into the night sky, and the invitation is written out in sparks before settling
into a readable card.

Vite + vanilla JS (ES modules) + Canvas 2D. All audio is synthesized at runtime
with the Web Audio API, so there are no audio assets and no licences to track.
There are no runtime dependencies.

## Commands

```bash
npm install
npm run dev           # dev server
npm run build         # static build  -> dist/
npm run preview       # serve the build
npm run build:single  # one self-contained HTML file -> dist-single/
```

## Where things live

- `docs/specs/` — the design spec (content, palette, art direction).
- `docs/plans/` — the phased implementation plan.
- `src/config/content.js` — every word on the page, including the date and the
  location placeholder.

Full documentation is written in Phase 10.
