import { twMerge } from "tailwind-merge";

/**
 * Joins conditional Tailwind class fragments and resolves any conflicting
 * utility (e.g. two different `bg-*` values) in favor of the last one --
 * the same small pattern already used in this workspace's
 * `prototypes/ui-compat-lab`, not a new invention. Replaces manual
 * `` `base ${condition ? "a" : "b"}` `` template literals, which don't
 * dedupe conflicting utilities and read as one long unbroken string.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
	return twMerge(classes.filter(Boolean).join(" "));
}
