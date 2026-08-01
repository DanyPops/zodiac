import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES_PATH = fileURLToPath(new URL("./styles.css", import.meta.url));

function hexToRgb(hex: string): [number, number, number] {
	const value = hex.length === 4 ? hex.replace(/./g, (char, index) => (index === 0 ? char : char + char)) : hex;
	return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)];
}

/**
 * Regression guard for two real, live bugs, not just eyeballed screenshots:
 *
 * 1. The shell's dark mode looked blue-tinted, not a true black/grey scale.
 *    Root cause was Tailwind's own "gray" palette (cool-toned, e.g. #111827
 *    where blue clearly leads red and green) plus dockview-core's "Abyss"
 *    dark theme (literally navy/purple at its color roots -- #000c18,
 *    #1c1c2a, #2b2b4a).
 * 2. The brand accent itself was a blue highlight (#0066cc) -- explicitly
 *    unwanted; black & white only, for now. Every accent-adjacent color, in
 *    both this app's own palette and dockview's own literal defaults
 *    (dodgerblue for a paneview's active outline, a purple active-sash),
 *    must be achromatic too.
 *
 * Reads styles.css directly rather than duplicating hex values here, so
 * this fails the moment any of these regress back to a tinted one, not
 * just when someone remembers to eyeball a screenshot.
 */
describe("black & white only palette", () => {
	const css = readFileSync(STYLES_PATH, "utf8");

	it("every --color-gray-* swatch is achromatic (R=G=B), not Tailwind's cool-toned gray", () => {
		const matches = [...css.matchAll(/--color-gray-\d+:\s*(#[0-9a-fA-F]{3,6});/g)];
		expect(matches.length).toBeGreaterThanOrEqual(11); // 50..950, the full scale
		for (const [, hex] of matches) {
			const [r, g, b] = hexToRgb(hex!);
			expect(r, `${hex} should be achromatic`).toBe(g);
			expect(g, `${hex} should be achromatic`).toBe(b);
		}
	});

	it("every --color-accent* swatch is achromatic (R=G=B) -- no blue highlight, black & white only for now", () => {
		const matches = [...css.matchAll(/--color-accent[a-z0-9-]*:\s*(#[0-9a-fA-F]{3,6});/g)];
		expect(matches.length).toBeGreaterThanOrEqual(9); // 10..80 plus the bare base
		for (const [, hex] of matches) {
			const [r, g, b] = hexToRgb(hex!);
			expect(r, `${hex} should be achromatic`).toBe(g);
			expect(g, `${hex} should be achromatic`).toBe(b);
		}
	});

	it("dockview's abyss-spaced dark theme's own color roots are overridden to achromatic grays, not left blue-purple", () => {
		const block = css.slice(css.indexOf(".dockview-theme-abyss-spaced {"));
		const matches = [...block.matchAll(/--dv-color-abyss[a-z-]*:\s*(#[0-9a-fA-F]{3,6})\s*!important;/g)];
		expect(matches.length).toBeGreaterThanOrEqual(4); // dark, (bare) abyss, light, lighter
		for (const [, hex] of matches) {
			const [r, g, b] = hexToRgb(hex!);
			expect(r, `${hex} should be achromatic`).toBe(g);
			expect(g, `${hex} should be achromatic`).toBe(b);
		}
	});

	it("dockview's own literal blue/purple defaults (paneview active outline, abyss active sash) are overridden to achromatic", () => {
		const matches = [...css.matchAll(/--dv-(?:paneview-active-outline-color|active-sash-color):\s*(#[0-9a-fA-F]{3,6})\s*!important;/g)];
		expect(matches.length).toBeGreaterThanOrEqual(2); // the shared paneview-outline rule, plus abyss's own active-sash rule
		for (const [, hex] of matches) {
			const [r, g, b] = hexToRgb(hex!);
			expect(r, `${hex} should be achromatic`).toBe(g);
			expect(g, `${hex} should be achromatic`).toBe(b);
		}
	});
});
