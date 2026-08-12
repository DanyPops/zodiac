/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ZODIAC_SIGNS } from "./zodiac-sign-catalog.js";
import { LibraIcon } from "./zodiac-signs.js";

afterEach(() => {
	cleanup();
});

describe("zodiac sign icon components", () => {
	it("renders each sign's own icon as a real, distinct <svg>, not 12 copies of one shape", () => {
		const paths = ZODIAC_SIGNS.map((sign) => {
			const { container } = render(<sign.icon aria-hidden="true" />);
			const svg = container.querySelector("svg");
			expect(svg).not.toBeNull();
			return svg!.innerHTML;
		});
		expect(new Set(paths).size).toBe(12);
	});

	it("passes size and className through to the rendered <svg>, same call shape as a lucide icon", () => {
		const { container } = render(<LibraIcon size={32} className="text-accent" aria-hidden="true" />);
		const svg = container.querySelector("svg")!;
		expect(svg).toHaveAttribute("width", "32");
		expect(svg).toHaveAttribute("height", "32");
		expect(svg).toHaveClass("text-accent");
	});
});
