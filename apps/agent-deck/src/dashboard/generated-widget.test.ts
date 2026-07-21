import { describe, expect, it } from "vitest";
import { findGeneratedWidgetPreset, parseWidgetPrompt } from "./generated-widget.js";

describe("parseWidgetPrompt", () => {
	it("recognizes the CI-initiated-by-me example prompt exactly", () => {
		expect(parseWidgetPrompt("Create a widget which show only the CI jobs I've initiated")).toBe("ci-initiated-by-me");
	});

	it("recognizes the bugs-assigned-to-me example prompt exactly", () => {
		expect(parseWidgetPrompt("Create a widget which only shows the bugs which are assigned to me")).toBe("tickets-assigned-to-me");
	});

	it("is case-insensitive", () => {
		expect(parseWidgetPrompt("CREATE A WIDGET FOR CI JOBS I'VE INITIATED")).toBe("ci-initiated-by-me");
	});

	it("does not match CI jobs without a 'me/my' reference (too broad, would show everyone's)", () => {
		expect(parseWidgetPrompt("show all CI jobs that were initiated")).toBeUndefined();
	});

	it("does not match issues without an assignment reference", () => {
		expect(parseWidgetPrompt("show me all the bugs")).toBeUndefined();
	});

	it("returns undefined for a genuinely unrecognized request, not a guess", () => {
		expect(parseWidgetPrompt("what's the weather like")).toBeUndefined();
		expect(parseWidgetPrompt("")).toBeUndefined();
	});

	it("does not cross-match CI keywords into the tickets preset or vice versa", () => {
		expect(parseWidgetPrompt("bugs I've initiated")).toBeUndefined(); // "bugs" + "initiated" but no "assign"
		expect(parseWidgetPrompt("CI jobs assigned to me")).toBeUndefined(); // "ci" + "assign" but no "initiat"
	});
});

describe("findGeneratedWidgetPreset", () => {
	it("resolves a known preset key to its category and title", () => {
		const preset = findGeneratedWidgetPreset("ci-initiated-by-me");
		expect(preset?.category).toBe("ci");
		expect(preset?.title).toBe("CI jobs I've initiated");
	});

	it("returns undefined for an unknown key rather than throwing", () => {
		expect(findGeneratedWidgetPreset("not-a-real-preset")).toBeUndefined();
	});
});
