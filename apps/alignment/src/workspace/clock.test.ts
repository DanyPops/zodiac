import { describe, expect, it } from "vitest";
import { formatClock } from "./clock.js";

describe("formatClock", () => {
	it("formats a morning time as HH:MM, 24-hour, zero-padded", () => {
		expect(formatClock(new Date(2024, 0, 1, 9, 5))).toBe("09:05");
	});

	it("formats an afternoon time past noon without a 12-hour wrap", () => {
		expect(formatClock(new Date(2024, 0, 1, 14, 30))).toBe("14:30");
	});

	it("formats midnight as 00:00, not 24:00 or 12:00", () => {
		expect(formatClock(new Date(2024, 0, 1, 0, 0))).toBe("00:00");
	});
});
