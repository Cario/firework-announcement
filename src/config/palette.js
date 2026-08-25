/**
 * The colour table from the spec, as a flat object of hex strings.
 *
 * This is the ONLY file in `src/` allowed to contain a hex colour literal.
 * Phase 10's audit greps for `#rrggbb` across `src/**\/*.js` excluding this
 * file and expects zero hits, so every fill, stroke and gradient stop
 * anywhere else must read from `PALETTE`.
 *
 * Keys are camelCase versions of the spec's CSS custom property names:
 *   --night-0 -> night0,  --grass-hi -> grassHi,  --white-spark -> whiteSpark
 *
 * Source: docs/specs/2026-08-25-nikkah-invite-design.md § "Art direction"
 */
export const PALETTE = {
  // Sky — vertical gradient, zenith to horizon.
  night0: '#0a1230', // zenith sky
  night1: '#132048', // mid sky
  night2: '#1d2f63', // horizon sky

  // Ground bands — darkest at the bottom of the frame.
  grass: '#0b1a11',
  grassMid: '#12271a',
  grassHi: '#1a3924',

  // Grass blades — `blade` near the camera, `bladeLo` toward the horizon.
  blade: '#2f6a3e',
  bladeLo: '#1d4128',

  // Treeline — alternating so the conifers read as separate silhouettes.
  tree: '#081c16',
  tree2: '#0d2a20',

  // Distant hills, sitting just above the ground line.
  hill: '#101f45',

  // Clouds — shaded underside / body / lit top edge.
  cloudLo: '#1d2a52',
  cloudMid: '#2e3f74',
  cloudHi: '#485d9e',

  // Exhaust smoke. NOTE: the spec's palette table has no `--smoke` row even
  // though Phase 5.3 calls for it by name. Chosen here as a desaturated
  // blue-grey one step lighter than `cloudHi` so puffs read against the night
  // sky at their 0.30 starting alpha without turning into white blobs.
  smoke: '#7e88a6',

  // Fireworks — gold is the primary, white the flare highlight.
  gold: '#f0c25e',
  goldHi: '#fbe6ab',
  whiteSpark: '#fdf9ee',

  // Secondary firework colours.
  green: '#5ed99a',
  blue: '#5fa0f2',

  // Rocket body.
  red: '#c8402f',
  redHi: '#e4644f',
  redLo: '#8f2f22',

  // The Urdu rocket's livery: the same three-step cylinder shading as the red
  // one, shifted to a deep cobalt. Picked to read as unmistakably "the other
  // firework" against the night sky without competing with the gold sparks —
  // `blue` above is a spark colour and is far too light for a rocket body.
  rocketBlue: '#2f57c8',
  rocketBlueHi: '#4f7be4',
  rocketBlueLo: '#22348f',

  // Match and exhaust flame.
  flame: '#ffb347',

  // Invite card.
  cardBg: '#fbf6e9',
  cardInk: '#241d10',
  cardSub: '#6b5f3e',
  rule: '#d8c793',

  // --- Set-piece props ------------------------------------------------
  // Not rows in the spec's palette table, but named as bare hex literals in
  // the plan (Phase 3.4 rocket stick, Phase 3.5 fuse cord). They live here so
  // the "no hex outside palette.js" rule still holds when those are drawn.
  stick: '#9c8a63', // rocket stick / match stick, weathered wood
  fuse: '#cbbfa2', // unlit fuse cord
};

/**
 * Frozen so a scene module cannot accidentally mutate a shared colour and
 * change the look of every later phase.
 */
Object.freeze(PALETTE);
