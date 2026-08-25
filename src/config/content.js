/**
 * Every word on the page. Single source of truth for all copy.
 *
 * Nothing anywhere else in `src/` may paraphrase, re-type or reflow these
 * strings — import them. Changing the venue is a one-line edit here
 * (`locationLine` and `card.location`), and so is changing the date
 * (`dateLine` and `card.date`).
 *
 * Verbatim from the approved spec:
 *   docs/specs/2026-08-25-nikkah-invite-design.md § "Confirmed content"
 *   - the date is January 1, 2027 (not 2026)
 *   - the bride's father is Kashif Ali (not Ali Kashif)
 */
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
