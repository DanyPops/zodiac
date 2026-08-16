import { AquariusIcon, AriesIcon, CancerIcon, CapricornIcon, GeminiIcon, LeoIcon, LibraIcon, PiscesIcon, SagittariusIcon, ScorpioIcon, TaurusIcon, VirgoIcon, type ZodiacSignIconProps } from "./zodiac-signs.js";

/** A zodiac sign id, lowercase and unaccented -- the vendored SVG's own filename stem (see apps/web/src/assets/zodiac-signs/, which stays there as reference-only attribution material, never imported code), so `ZODIAC_SIGNS_BY_ID[id]` and the source asset share one name to look up by. */
export type ZodiacSignId = "aries" | "taurus" | "gemini" | "cancer" | "leo" | "virgo" | "libra" | "scorpio" | "sagittarius" | "capricorn" | "aquarius" | "pisces";

/** One inclusive end of a tropical-zodiac date range -- a month/day pair rather than a Date, since the range recurs every year and never carries its own year. */
export interface ZodiacMonthDay {
	readonly month: number;
	readonly day: number;
}

export interface ZodiacSign {
	readonly id: ZodiacSignId;
	readonly label: string;
	/** The commonly-cited Western tropical-zodiac date range (e.g. https://www.zodiacsign.com/, in agreement with most popular sources) -- Capricorn is the one sign whose range crosses the year boundary (Dec 22 -> Jan 19), so `start` is not always <= `end` by (month, day) ordering; see resolveZodiacSign's own callers for the wraparound this implies before ever comparing against it. */
	readonly start: ZodiacMonthDay;
	readonly end: ZodiacMonthDay;
	readonly icon: (props: ZodiacSignIconProps) => React.JSX.Element;
}

/**
 * All 12 signs, in the order the sun actually visits them across the
 * calendar year (Aries first at the spring equinox) -- covers all 12
 * months between them, each sign's `start`/`end` a real, sourced date
 * range rather than a decorative placeholder.
 */
export const ZODIAC_SIGNS: readonly ZodiacSign[] = [
	{ id: "aries", label: "Aries", start: { month: 3, day: 21 }, end: { month: 4, day: 19 }, icon: AriesIcon },
	{ id: "taurus", label: "Taurus", start: { month: 4, day: 20 }, end: { month: 5, day: 20 }, icon: TaurusIcon },
	{ id: "gemini", label: "Gemini", start: { month: 5, day: 21 }, end: { month: 6, day: 20 }, icon: GeminiIcon },
	{ id: "cancer", label: "Cancer", start: { month: 6, day: 21 }, end: { month: 7, day: 22 }, icon: CancerIcon },
	{ id: "leo", label: "Leo", start: { month: 7, day: 23 }, end: { month: 8, day: 22 }, icon: LeoIcon },
	{ id: "virgo", label: "Virgo", start: { month: 8, day: 23 }, end: { month: 9, day: 22 }, icon: VirgoIcon },
	{ id: "libra", label: "Libra", start: { month: 9, day: 23 }, end: { month: 10, day: 22 }, icon: LibraIcon },
	{ id: "scorpio", label: "Scorpio", start: { month: 10, day: 23 }, end: { month: 11, day: 21 }, icon: ScorpioIcon },
	{ id: "sagittarius", label: "Sagittarius", start: { month: 11, day: 22 }, end: { month: 12, day: 21 }, icon: SagittariusIcon },
	{ id: "capricorn", label: "Capricorn", start: { month: 12, day: 22 }, end: { month: 1, day: 19 }, icon: CapricornIcon },
	{ id: "aquarius", label: "Aquarius", start: { month: 1, day: 20 }, end: { month: 2, day: 18 }, icon: AquariusIcon },
	{ id: "pisces", label: "Pisces", start: { month: 2, day: 19 }, end: { month: 3, day: 20 }, icon: PiscesIcon },
];

/** Keyed by plain `string`, not ZodiacSignId, so an unrecognized id (a lookup this table was never built to answer, e.g. a stale persisted preference from a since-removed sign) really does type-check as possibly `undefined` under the project's own noUncheckedIndexedAccess -- see resolveZodiacSign's real fallback below, which depends on that. */
const ZODIAC_SIGNS_BY_ID: Readonly<Record<string, ZodiacSign>> = Object.fromEntries(ZODIAC_SIGNS.map((sign) => [sign.id, sign]));

export const DEFAULT_ZODIAC_SIGN_ID: ZodiacSignId = "libra";

/** A sign id that doesn't name a known ZODIAC_SIGNS entry falls back to DEFAULT_ZODIAC_SIGN_ID rather than throwing -- same defensive-fallback convention as workspace-catalog.tsx's resolveWorkspaceGlyph, for the same reason (a persisted preference naming a since-renamed id must still render something). */
export function resolveZodiacSign(id: string): ZodiacSign {
	return ZODIAC_SIGNS_BY_ID[id] ?? ZODIAC_SIGNS_BY_ID[DEFAULT_ZODIAC_SIGN_ID]!;
}
