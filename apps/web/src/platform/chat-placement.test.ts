import { describe, expect, it } from "vitest";
import { chatOrientation, CHAT_SIZE_RATIO, DEFAULT_CHAT_PLACEMENT, isChatPlacement } from "./chat-placement.js";

describe("chat-placement", () => {
	it("default placement is a real placement value", () => {
		expect(isChatPlacement(DEFAULT_CHAT_PLACEMENT)).toBe(true);
	});

	it("the size ratio sits within the requested 1/5-1/4 range", () => {
		expect(CHAT_SIZE_RATIO).toBeGreaterThanOrEqual(0.2);
		expect(CHAT_SIZE_RATIO).toBeLessThanOrEqual(0.25);
	});

	describe("isChatPlacement", () => {
		it("accepts all four edges", () => {
			for (const value of ["top", "bottom", "left", "right"]) expect(isChatPlacement(value)).toBe(true);
		});

		it("rejects anything else", () => {
			for (const value of ["center", "", 42, null, undefined, {}]) expect(isChatPlacement(value)).toBe(false);
		});
	});

	describe("chatOrientation", () => {
		it("top/bottom is horizontal", () => {
			expect(chatOrientation("top")).toBe("horizontal");
			expect(chatOrientation("bottom")).toBe("horizontal");
		});

		it("left/right is vertical", () => {
			expect(chatOrientation("left")).toBe("vertical");
			expect(chatOrientation("right")).toBe("vertical");
		});
	});
});
