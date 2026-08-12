/**
 * "Gradient to Contrast": Zodiac's shared surface ladder, named after
 * the Window Carousel (the pattern's original, reference implementation).
 * Three fixed steps, each theme tuned on its own terms rather than a
 * naive lightness-inversion of the other's:
 *
 *   page (PAGE_BG)       -- gray-200 / black,    furthest back -- App.tsx's own root only
 *   well (WELL_BG)       -- gray-100 / gray-900, one step forward -- the Window's canvas
 *   surface (SURFACE_BG) -- white   / gray-800, nearest the user
 *
 * PAGE_BG's dark step is literal black, not gray-950: gray-950 (#0a0a0a) and
 * gray-900 (#171717) sit only 13/255 apart, a gap real displays and casual
 * screenshots reliably crush into "one big black area" -- confirmed live
 * (a real dark-mode render's computed styles showed rgb(10,10,10) for the
 * page immediately abutting rgb(23,23,23) for the well, with no visible
 * seam between them). Anchoring the page at true black instead widens that
 * gap to 23/255 and, just as importantly, moves the page across the
 * "true black" vs. "a gray" perceptual category boundary displays and eyes
 * both resolve far more reliably than a same-family shade difference this
 * small. WELL_BG and SURFACE_BG are untouched: their own 15/255 gap already
 * reads fine (confirmed the same way), and either one's exact gray-900/800
 * value is referenced nowhere else in this app to shift out from under.
 *
 * All three are promoted to named constants, not just `surface`: the same
 * "restating raw Tailwind color classes per file" drift `SURFACE_BG` was
 * originally extracted to prevent applies equally to `page` and `well` --
 * each has more than one call site (`page`: the app root plus its own
 * `data-*`-carrying wrapper; `well`: the Window canvas section and the
 * empty-state landing) and both drifted to the exact same literal string
 * independently before this promotion, which is exactly the failure mode a
 * shared constant catches at compile time instead of at visual review.
 *
 * Every pillar, dialog, docked panel, and floating overlay is a surface.
 * `SURFACE_BG` is the shared, single source of truth for that step --
 * import it instead of restating "bg-white ... dark:bg-gray-900" per file.
 */
export const PAGE_BG = "bg-gray-200 dark:bg-black";
export const WELL_BG = "bg-gray-100 dark:bg-gray-900";
export const SURFACE_BG = "bg-white dark:bg-gray-800";
