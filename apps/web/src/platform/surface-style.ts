/**
 * "Gradient to Contrast": Zodiac's shared surface ladder, named after
 * the Window Carousel (the pattern's original, reference implementation).
 * Three fixed steps, each theme tuned on its own terms rather than a
 * naive lightness-inversion of the other's:
 *
 *   page (PAGE_BG)       -- gray-200 / black,   furthest back -- App.tsx's own root only
 *   well (WELL_BG)       -- gray-100 / #1e1e1e, one step forward -- the Window's canvas
 *   surface (SURFACE_BG) -- white    / gray-800, nearest the user
 *
 * Both dark steps needed real, deliberate work, not the naive "just invert
 * the light-mode gray" this ladder's own header warns against -- confirmed
 * live at every stage, not assumed:
 *
 * PAGE_BG is literal black, not gray-950: gray-950 (#0a0a0a) and gray-900
 * (#171717) sit only 13/255 apart, a gap real displays and casual
 * screenshots reliably crush into "one big black area" (confirmed via a
 * real dark-mode render's own computed styles: rgb(10,10,10) immediately
 * abutting rgb(23,23,23), no visible seam). Anchoring the page at true
 * black widens that specific seam and crosses the "true black" vs. "a
 * gray" perceptual category boundary -- but it does nothing for how dark
 * gray-900 looks *on its own*, which is WELL_BG's own separate problem:
 * rgb(23,23,23) is only ~9% brightness, dark enough to still read as flat
 * black by itself regardless of what's behind it (real user report, after
 * the PAGE_BG fix above shipped: "it is still pitch black").
 *
 * WELL_BG's dark step is therefore its own explicit value, not another
 * step on the shared gray-* scale: gray-800 (#262626, 38/255) is already
 * SURFACE_BG's own value, and gray-900 is what's being replaced, so
 * nothing on the scale sits usefully between them -- the whole 0-38 budget
 * between true-black PAGE_BG and SURFACE_BG is too narrow to carve out a
 * third, clearly-distinct-looking shade without also moving SURFACE_BG
 * (which ~68 other call sites' own hover/border shades are independently
 * tuned relative to -- confirmed via grep -- and moving it risks a hover
 * state silently becoming invisible against its own new resting color).
 * #1e1e1e (30/255, ~12% brightness) is VS Code's own editor background --
 * not an arbitrary tuning, a widely-used, already-vetted reference point
 * for "visibly a dark gray, not pitch black" at exactly this kind of
 * surface size. It sits close to SURFACE_BG's 38 (an 8/255 gap, tighter
 * than the old well/surface gap), traded off deliberately: the well and
 * surface never share a direct, unbroken edge the way page and well do
 * (surface elements sit across a real `gap-2` flex seam and carry their
 * own borders/icons/shadows), so a tighter *numeric* gap there costs far
 * less *visible* separation than the same gap would where page meets well.
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
export const WELL_BG = "bg-gray-100 dark:bg-[#1e1e1e]";
export const SURFACE_BG = "bg-white dark:bg-gray-800";
