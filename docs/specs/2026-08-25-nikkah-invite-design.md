# Nikkah announcement site — design spec

Date: 2026-08-25
Status: approved (visual direction signed off via storyboard artifact)

## Purpose

A single-page website that announces a nikkah ceremony. A visitor opens the link,
lights a firework, watches it climb into the night sky and burst into text that
delivers the invitation, and is left with a readable invitation card.

The primary audience includes elderly and non-technical viewers. Most will open
it on a phone. Nothing may require scrolling, zooming, hunting for a control, or
understanding any convention beyond "tap the glowing thing".

## Confirmed content (canonical — do not paraphrase in code)

Sequence text, in order:

1. `SURPRISE`
2. `You are invited to the Nikkah ceremony`
3. `of Muhammad Asjad, the beloved son of Ahmed Shemail and Munazzah Asif`
4. `with Neha Kashif, the beloved daughter of Kashif Ali and Aisha Kashif`
5. `January 1, 2027` / `Location to be announced`

Final card text:

> You are invited to the Nikkah ceremony
>
> **Muhammad Asjad**
> beloved son of Ahmed Shemail & Munazzah Asif
>
> **Neha Kashif**
> beloved daughter of Kashif Ali & Aisha Kashif
>
> **January 1, 2027**
> Location to be announced

Resolved ambiguities from the brief:
- Date is **January 1, 2027** (not 2026).
- Bride's father is **Kashif Ali** (not Ali Kashif).
- Location is a deliberate placeholder; text must live in one config constant so
  it can be replaced with one edit.

## Decisions

| Decision | Choice |
|---|---|
| Stack | Vite + vanilla JS (ES modules) + Canvas 2D |
| Hosting | Vercel (static output; also works on Netlify/GitHub Pages) |
| Repo | Local git from the start; no remote pushed by Claude |
| Project path | `C:\Users\mdasj\Desktop\nikkah-invite` |
| Audio | Synthesized at runtime with Web Audio API — no audio files, no licensing |
| Sound default | On; visible mute toggle at all times |
| Skip control | None — everyone watches the sequence |
| Total duration | ~30 seconds, tap to card |
| Card entrance | Parchment card floats over the night sky, which stays visible |
| Replay | Yes — button on the card |
| RSVP / backend | None. Pure announcement. |
| Photos | None. Text-only card. |

## Art direction (locked by the approved storyboard)

Palette:

| Token | Hex | Role |
|---|---|---|
| `--night-0` | `#0a1230` | zenith sky |
| `--night-1` | `#132048` | mid sky |
| `--night-2` | `#1d2f63` | horizon sky |
| `--grass` / `--grass-mid` / `--grass-hi` | `#0b1a11` / `#12271a` / `#1a3924` | ground bands |
| `--blade` / `--blade-lo` | `#2f6a3e` / `#1d4128` | grass blades |
| `--tree` / `--tree-2` | `#081c16` / `#0d2a20` | treeline |
| `--hill` | `#101f45` | distant hills |
| `--cloud-lo/mid/hi` | `#1d2a52` / `#2e3f74` / `#485d9e` | cloud shade / body / lit edge |
| `--gold` / `--gold-hi` | `#f0c25e` / `#fbe6ab` | primary firework, CTA |
| `--white-spark` | `#fdf9ee` | white flares |
| `--green` / `--blue` | `#5ed99a` / `#5fa0f2` | secondary fireworks |
| `--red` / `--red-hi` / `--red-lo` | `#c8402f` / `#e4644f` / `#8f2f22` | rocket body |
| `--flame` | `#ffb347` | match and exhaust flame |
| `--card-bg` / `--card-ink` / `--card-sub` / `--rule` | `#fbf6e9` / `#241d10` / `#6b5f3e` / `#d8c793` | invite card |

Type:
- Display / ceremonial: **Cormorant Garamond** (600, and 600 italic).
- UI / captions: **Jost** (400, 500).
- No script face. Legibility for elderly readers outranks flourish.

Firework rendering rules:
- Sparks are **crisp points with short directional streaks**. No blur, no glow
  halos, no radial-gradient blobs.
- Sky text is formed **by the sparks themselves** — flares originate at the glyph
  centre and the letters resolve out of them.
- Letters carry a fine dotted texture so strokes read as composed of embers.

Scene rules:
- No moon. Stars twinkle on independent phases.
- Grass blades fill the full ground band with near-to-far scale.
- Treeline and hills sit on the horizon behind the grass.
- Clouds are single continuous silhouettes (merged-arc outline, shaded underside,
  lit top edge) at multiple depths; the rocket passes behind some and in front of
  others — deliberate, for parallax depth.
- The rocket is a classic red firework: nose cone, striped body, fins, stick.
- The flame belongs to the **match**, never to the unlit fuse.

## Interaction model

Idle state:
- Rocket staked in the meadow, fuse running from its base to an unlit tip.
- A pulsing gold ring marks the fuse tip.
- A lit match rests beside it; a **ghosted copy of the match** loops in to touch
  the fuse tip, sparks it, and retracts — demonstrating the action wordlessly.
- Label near the rocket: "Tap the fuse to light it".
- The entire viewport is the hit target: click, tap, Enter, or Space all fire it.

After launch: no further interaction is required. Mute toggle stays available.

End state: invite card over the sky, with a replay button.

## Non-goals

- No RSVP, no forms, no backend, no analytics.
- No photos.
- No scroll. The experience is one fixed viewport.
- No skip control.
