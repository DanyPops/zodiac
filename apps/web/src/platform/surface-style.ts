/**
 * "Gradient to Contrast": shared surface ladder, three fixed steps.
 *
 *   page    -- gray-200 / black,     furthest back
 *   well    -- gray-100 / well-dark, the Window's canvas
 *   surface -- white    / gray-800,  nearest the user
 *
 * Dark steps aren't a naive light-mode inversion:
 * - page is literal black, not gray-950 -- gray-950/gray-900 are only
 *   13/255 apart, visually one flat black area.
 * - well's dark value is its own named token (`--color-well-dark` in
 *   styles.css), not another gray-* rung -- gray-800 is already surface's,
 *   and gray-900 alone reads as flat black. The dockview theme override
 *   in styles.css reads the same token, so the two can't drift apart.
 *
 * Named constants (not raw Tailwind classes per file) so every call site
 * stays in sync -- each step has more than one consumer.
 */
export const PAGE_BG = "bg-gray-200 dark:bg-black";
export const WELL_BG = "bg-gray-100 dark:bg-well-dark";
export const SURFACE_BG = "bg-white dark:bg-gray-800";
