/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WispCursor } from "./WispCursor.js";

afterEach(cleanup);

function getWisp(container: HTMLElement): HTMLElement {
	return container.querySelector("[aria-hidden]:not([data-wisp-cursor-anchor])") as HTMLElement;
}

describe("WispCursor", () => {
	it("renders a static, never-transformed anchor marker at the same base position as the visible dot", () => {
		const { container } = render(<WispCursor visible={true} />);
		const anchor = container.querySelector("[data-wisp-cursor-anchor]") as HTMLElement;
		expect(anchor).not.toBeNull();
		expect(anchor.className).not.toContain("transition");
		expect(anchor.getAttribute("style")).toBeNull();
	});

	it("is inert and fully transparent while not visible", () => {
		const { container } = render(<WispCursor visible={false} />);
		const wisp = getWisp(container);
		expect(wisp).toHaveAttribute("inert");
		expect(wisp.style.opacity).toBe("0");
	});

	it("is interactive-inert-free (visible) and opaque once visible", () => {
		const { container } = render(<WispCursor visible={true} />);
		const wisp = getWisp(container);
		expect(wisp).not.toHaveAttribute("inert");
		expect(wisp.style.opacity).toBe("1");
	});

	it("never intercepts pointer events -- it is cosmetic, never a click target", () => {
		const { container } = render(<WispCursor visible={true} />);
		const wisp = getWisp(container);
		expect(wisp.className).toContain("pointer-events-none");
	});

	it("translates toward a given target instead of staying at the idle anchor", () => {
		const { container } = render(<WispCursor visible={true} target={{ x: 120, y: -40 }} />);
		const wisp = getWisp(container);
		expect(wisp.style.transform).toContain("translate(120px, -40px)");
	});
});
