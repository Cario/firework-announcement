/**
 * Every word on the site, in both languages. Single source of truth.
 *
 * The firework choreography is DERIVED from these strings — `timeline.js`
 * splits each line on spaces and schedules one shell, one burst and one sound
 * per word. So a line with more words automatically gets more fireworks, and
 * the two languages need no separate tuning: Urdu's different word counts flow
 * through to the sequence on their own.
 *
 * URDU NOTES, because the script is not just "English with different glyphs":
 *
 *  - It is right-to-left. `dir: 'rtl'` drives both the card and the sky
 *    layout, which packs its rows from the right.
 *  - Letters change shape according to their neighbours and join into
 *    ligatures. Splitting on spaces is safe (shaping never crosses a space),
 *    but splitting *within* a word would destroy it — and so would drawing a
 *    word character by character, which is why the tracked-letterspacing path
 *    used for "SURPRISE" is disabled for Urdu.
 *  - It is set in Nastaliq, which cascades diagonally downward. Glyphs
 *    routinely fall far outside the box a Latin face of the same size would
 *    occupy, so the sampler is given extra vertical room for it.
 *  - `ِ` (zer/kasra) in "تقریبِ" marks an izafat construction. It is a
 *    combining mark, not a separate letter, and must stay attached.
 */

/** English. */
export const CONTENT_EN = {
  lang: 'en',
  dir: 'ltr',
  label: 'English',
  htmlLang: 'en',

  surprise: 'SURPRISE',
  lines: [
    'You are invited to the Nikah ceremony',
    'of Muhammad Asjad, the beloved son of Ahmed Shemail and Munazzah Asif',
    'with Neha Kashif, the beloved daughter of Kashif Ali and Aisha Kashif',
  ],
  dateLine: 'January 1, 2027',
  locationLine: 'Location to be announced',

  card: {
    eyebrow: 'Nikah',
    intro: 'You are invited to the Nikah ceremony',
    groom: 'Muhammad Asjad',
    groomParents: 'beloved son of Ahmed Shemail & Munazzah Asif',
    bride: 'Neha Kashif',
    brideParents: 'beloved daughter of Kashif Ali & Aisha Kashif',
    date: 'January 1, 2027',
    location: 'Location to be announced',
  },

  prompt: 'Tap the fuse to light it',
  chooser: 'Tap a firework to begin',
  replay: 'Watch again',
  muteOn: 'Mute sound',
  muteOff: 'Unmute sound',
};

/** Urdu. */
export const CONTENT_UR = {
  lang: 'ur',
  dir: 'rtl',
  label: 'اردو',
  htmlLang: 'ur',

  surprise: 'سرپرائز',
  lines: [
    'آپ کو تقریبِ نکاح میں مدعو کیا جاتا ہے',
    'محمد اسجد، احمد شمائل اور منزہ آصف کے لختِ جگر',
    'نیہا کاشف، کاشف علی اور عائشہ کاشف کی لختِ جگر کے ساتھ',
  ],
  dateLine: 'یکم جنوری ۲۰۲۷',
  locationLine: 'مقام کا اعلان بعد میں کیا جائے گا',

  card: {
    eyebrow: 'نکاح',
    intro: 'آپ کو تقریبِ نکاح میں مدعو کیا جاتا ہے',
    groom: 'محمد اسجد',
    groomParents: 'احمد شمائل و منزہ آصف کے لختِ جگر',
    bride: 'نیہا کاشف',
    brideParents: 'کاشف علی و عائشہ کاشف کی لختِ جگر',
    date: 'یکم جنوری ۲۰۲۷',
    location: 'مقام کا اعلان بعد میں کیا جائے گا',
  },

  prompt: 'فتیلہ جلانے کے لیے دبائیں',
  chooser: 'شروع کرنے کے لیے کسی آتش بازی کو دبائیں',
  replay: 'دوبارہ دیکھیں',
  muteOn: 'آواز بند کریں',
  muteOff: 'آواز چالو کریں',
};

/** Both, in the order the two fireworks stand on the ground: English, Urdu. */
export const LANGUAGES = Object.freeze([CONTENT_EN, CONTENT_UR]);

/**
 * @param {'en'|'ur'} lang
 * @returns {typeof CONTENT_EN} the requested content, English if unrecognised.
 */
export function getContent(lang) {
  return lang === 'ur' ? CONTENT_UR : CONTENT_EN;
}

/**
 * Back-compat: the modules written before the site was bilingual import
 * `CONTENT` directly. It stays pointed at English.
 */
export const CONTENT = CONTENT_EN;
