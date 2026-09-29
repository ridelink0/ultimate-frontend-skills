/* What a fresh scaffold of each preset fires, written out, so that any change
   to the chassis shows up as a diff here rather than passing quietly.

   audit: the source checks (scripts/tells.mjs, run by the audit) that a
   scaffold raises. None, for every section combination the library can make
   (test/tells.test.mjs).

   rendered: the features of `webdesign.mjs tells` (scripts/tells-render.mjs)
   that fire on `new <dir> --preset <p>` with the default sections, at 1440
   and 390 (test/tells-render.test.mjs). These are the tells the chassis
   ships, measured 2026-09-29, and the rows of data/ai-tells.json with
   ufs_chassis_ships_it: true are exactly their union. The list is not a
   target: re-defaulting the chassis is a later piece of work, and when it
   lands, this is where it shows. */
const PAPER = ['cream-ground', 'template-chrome', 'overused-face', 'decorative-numbering', 'stat-banner', 'marquee', 'section-waterfall'];

export const EXPECTED_TELLS = {
  bone: { audit: [], rendered: PAPER },
  cinema: { audit: [], rendered: PAPER },
  fable: { audit: [], rendered: PAPER },
  ink: { audit: [], rendered: ['perma-dark', 'template-chrome', 'overused-face', 'decorative-numbering', 'stat-banner', 'marquee', 'section-waterfall'] },
};
