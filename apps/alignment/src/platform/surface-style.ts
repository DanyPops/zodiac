/**
 * "Gradient to Contrast": Alignment's shared surface ladder, named after
 * the Window Carousel (the pattern's original, reference implementation).
 * Three fixed steps, each theme tuned on its own terms rather than a
 * naive lightness-inversion of the other's:
 *
 *   page (App.tsx's own root)   -- gray-200 / gray-950, furthest back
 *   well (the Window's canvas)  -- gray-100 / gray-900, one step forward
 *   surface (this constant)     -- white   / gray-800, nearest the user
 *
 * Every pillar, dialog, docked panel, and floating overlay is a surface.
 * `SURFACE_BG` is the shared, single source of truth for that step --
 * import it instead of restating "bg-white ... dark:bg-gray-900" per file.
 */
export const SURFACE_BG = "bg-white dark:bg-gray-800";
