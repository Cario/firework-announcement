/**
 * Every word on the site, in both languages. Single source of truth.
 *
 * The firework choreography is DERIVED from these strings — `timeline.js`
 * splits each sky line on spaces and schedules one shell, one burst and one
 * sound per word. So a line with more words automatically gets more fireworks,
 * and the two languages need no separate tuning.
 *
 * URDU NOTES, because the script is not just "English with different glyphs":
 *
 *  - It is right-to-left. `dir: 'rtl'` drives both the card and the sky
 *    layout, which packs its rows from the right.
 *  - Letters change shape according to their neighbours and join into
 *    ligatures. Splitting on spaces is safe (shaping never crosses a space),
 *    but drawing a word character by character would destroy it, which is why
 *    the tracked-letterspacing path used for "SURPRISE" is disabled for Urdu.
 *  - It is set in Nastaliq, which cascades diagonally downward and reads
 *    smaller than a Latin face at the same pixel size — both compensated for
 *    in `fx/textPoints.js`.
 *  - `ِ` (zer) in "تقریبِ" and "دخترِ" marks an izafat construction. It is a
 *    combining mark, not a letter, and must stay attached to its word.
 *
 * The bismillah is Arabic, not Urdu, and appears on BOTH cards. It is set in
 * Naskh rather than Nastaliq, which is how Quranic Arabic is conventionally
 * typeset.
 */

/** Arabic, shared by both cards. */
export const BISMILLAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/** English. */
export const CONTENT_EN = {
  lang: 'en',
  dir: 'ltr',
  label: 'English',
  htmlLang: 'en',

  surprise: 'SURPRISE',

  /** The three sky lines, one firework per word. */
  lines: [
    'You are invited to the Nikah ceremony',
    'of Muhammad Asjad, the beloved son of Ahmed Shemail and Munazzah Asif',
    'with Neha Kashif, the beloved daughter of Kashif Ali and Aisha Kashif',
  ],

  /** The closing burst: when, then where. */
  dateLine: 'January 1, 2027',
  venueLines: ['Minha Ballroom', 'Shah Faisal Colony, Block 3, Karachi'],

  card: {
    bismillah: BISMILLAH,
    blessing: [
      'With the blessings of Allah (SWT),',
      'you are cordially invited to join us in celebrating',
      'the blessed Nikah ceremony of',
    ],
    groom: 'Muhammad Asjad',
    groomParents: 'Cherished son of Ahmed Shemail & Munazzah Asif',
    joiner: 'With',
    bride: 'Neha Kashif',
    brideParents: 'Beloved daughter of Kashif Ali & Aisha Kashif',
    dateLabel: 'On',
    date: 'January 1, 2027',
    venueLabel: 'At',
    venue: ['Minha Ballroom', 'Shah Faisal Colony, Block 3', 'Karachi'],
    closing: '',
  },

  chooser: 'Choose your language',
  replay: 'Watch again',
};

/** Urdu. */
export const CONTENT_UR = {
  lang: 'ur',
  dir: 'rtl',
  label: 'اردو',
  htmlLang: 'ur',

  surprise: 'سرپرائز',

  lines: [
    'آپ کو نہایت شادمانی کے ساتھ تقریبِ نکاح میں شرکت کی دعوت دی جاتی ہے',
    'محمد اسجد، فرزند احمد شمائل و منزہ آصف',
    'بہمراہ نِہٰا کاشف، دخترِ کاشف علی و عائشہ کاشف',
  ],

  dateLine: 'یکم جنوری، ۲۰۲۷ء',
  venueLines: ['منہا بال روم', 'شاہ فیصل کالونی، بلاک ۳، کراچی'],

  card: {
    bismillah: BISMILLAH,
    blessing: [
      'اللہ تعالیٰ کے فضل و کرم اور برکتوں کے ساتھ،',
      'آپ کو نہایت شادمانی کے ساتھ تقریبِ نکاح میں',
      'شرکت کی دعوت دی جاتی ہے۔',
    ],
    groom: 'محمد اسجد',
    groomParents: 'فرزند احمد شمائل و منزہ آصف',
    joiner: 'بہمراہ',
    bride: 'نِہٰا کاشف',
    brideParents: 'دخترِ کاشف علی و عائشہ کاشف',
    dateLabel: 'بتاریخ',
    date: 'یکم جنوری، ۲۰۲۷ء',
    venueLabel: 'بمقام',
    venue: ['منہا بال روم', 'شاہ فیصل کالونی، بلاک ۳', 'کراچی'],
    closing: 'آپ کی شرکت ہمارے لیے باعثِ مسرت و تشکر ہوگی',
  },

  chooser: 'اپنی زبان منتخب کریں',
  replay: 'دوبارہ دیکھیں',
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

/** Back-compat for modules written before the site was bilingual. */
export const CONTENT = CONTENT_EN;
