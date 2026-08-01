/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WispCursor } from "./WispCursor.js";

afterEach(cleanup);

describe("WispCursor", () => {
	it("is inert and fully transparent while not visible", () => {
		const { container } = render(<WispCursor visible={false} />);
		const wisp = container.firstElementChild as HTMLElement;
		expect(wisp).toHaveAttribute("inert");
		expect(wisp.style.opacity).toBe("0");
	});

	it("is interactive-inert-free (visible) and opaque once visible", () => {
		const { container } = render(<WispCursor visible={true} />);
		const wisp = container.firstElementChild as HTMLElement;
		expect(wisp).not.toHaveAttribute("inert");
		expect(wisp.style.opacity).toBe("1");
	});

	it("never intercepts pointer events -- it is cosmetic, never a click target", () => {
		const { container } = render(<WispCursor visible={true} />);
		const wisp = container.firstElementChild as HTMLElement;
		expect(wisp.className).toContain("pointer-events-none");
	});

	it("translates toward a given target instead of staying at the idle anchor", () => {
		const { container } = render(<WispCursor visible={true} target={{ x: 120, y: -40 }} />);
		const wisp = container.firstElementChild as HTMLElement;
		expect(wisp.style.transform).toContain("translate(120px, -40px)");
	});
});
