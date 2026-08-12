/**
 * "Gradient to Contrast": Zodiac's shared surface ladder, named after
 * the Window Carousel (the pattern's original, reference implementation).
 * Three fixed steps, each theme tuned on its own terms rather than a
 * naive lightness-inversion of the other's:
 *
 *   page (PAGE_BG)       -- gray-200 / gray-950, furthest back -- App.tsx's own root only
 *   well (WELL_BG)       -- gray-100 / gray-900, one step forward -- the Window's canvas
 *   surface (SURFACE_BG) -- white   / gray-800, nearest the user
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
export const PAGE_BG = "bg-gray-200 dark:bg-gray-950";
export const WELL_BG = "bg-gray-100 dark:bg-gray-900";
export const SURFACE_BG = "bg-white dark:bg-gray-800";
