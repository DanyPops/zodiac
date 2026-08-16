import { twMerge } from "tailwind-merge";

/**
 * Joins conditional Tailwind class fragments and resolves any conflicting
 * utility (e.g. two different `bg-*` values) in favor of the last one.
 * Zodiac Web's own `platform/cn.ts` keeps its own copy rather than
 * importing this one -- one three-line pure function isn't worth widening
 * every one of its many call sites' import paths just to de-duplicate it.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
	return twMerge(classes.filter(Boolean).join(" "));
}
