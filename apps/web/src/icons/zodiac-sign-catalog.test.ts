import { describe, expect, it } from "vitest";
import { DEFAULT_ZODIAC_SIGN_ID, resolveZodiacSign, ZODIAC_SIGNS, type ZodiacSignId } from "./zodiac-sign-catalog.js";

describe("ZODIAC_SIGNS", () => {
	it("has exactly 12 signs, one per month of the tropical zodiac year", () => {
		expect(ZODIAC_SIGNS).toHaveLength(12);
	});

	it("gives every sign a unique id, label, and icon component -- no shared placeholder", () => {
		const ids = ZODIAC_SIGNS.map((sign) => sign.id);
		const labels = ZODIAC_SIGNS.map((sign) => sign.label);
		const icons = ZODIAC_SIGNS.map((sign) => sign.icon);
		expect(new Set(ids).size).toBe(12);
		expect(new Set(labels).size).toBe(12);
		expect(new Set(icons).size).toBe(12);
	});

	it("covers every month of the year across the 12 signs' own start/end, including Capricorn's December -> January wraparound", () => {
		const monthsTouched = new Set<number>();
		for (const sign of ZODIAC_SIGNS) {
			monthsTouched.add(sign.start.month);
			monthsTouched.add(sign.end.month);
		}
		expect(monthsTouched.size).toBe(12);
		const capricorn = ZODIAC_SIGNS.find((sign) => sign.id === "capricorn")!;
		expect(capricorn.start.month).toBe(12);
		expect(capricorn.end.month).toBe(1);
	});

	it("defaults to Libra -- the placeholder sign this app's own user avatar currently renders", () => {
		expect(DEFAULT_ZODIAC_SIGN_ID).toBe("libra");
	});
});

describe("resolveZodiacSign", () => {
	it("resolves a known id to its own sign", () => {
		expect(resolveZodiacSign("aries").label).toBe("Aries");
	});

	it("falls back to the default sign for an unknown id, rather than throwing", () => {
		expect(resolveZodiacSign("not-a-real-sign" as ZodiacSignId).id).toBe(DEFAULT_ZODIAC_SIGN_ID);
	});
});
