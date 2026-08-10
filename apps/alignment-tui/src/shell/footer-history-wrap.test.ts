import { describe, expect, it } from "vitest";
import { wrapFooterHistory } from "./footer-history-wrap.js";

describe("wrapFooterHistory", () => {
	it("keeps a short message on a single row, unchanged", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "hi" }], 20);
		expect(rows).toEqual([{ text: "hi", style: { foreground: 7 } }]);
	});

	it("word-wraps a long message across multiple rows instead of truncating it", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "one two three four five six" }], 10);
		expect(rows.map((row) => row.text)).toEqual(["one two", "three four", "five six"]);
	});

	it("hard-breaks a single word longer than the available width", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "abcdefghij" }], 4);
		expect(rows.map((row) => row.text)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("splits on real embedded newlines as hard breaks, never joining two logical lines onto one row", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "line one\nline two" }], 20);
		expect(rows.map((row) => row.text)).toEqual(["line one", "line two"]);
	});

	it("renders an empty message as a single blank row rather than disappearing", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "" }], 20);
		expect(rows.map((row) => row.text)).toEqual([""]);
	});

	it("every wrapped row of a multi-row user bubble carries the same background, not just the first", () => {
		const rows = wrapFooterHistory([{ role: "user", text: "one two three four five" }], 8);
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) expect(row.background).toBe(4);
	});

	it("colors every wrapped row of a multi-row tool item by its status, bolded", () => {
		const rows = wrapFooterHistory([{ role: "tool", text: "a very long tool name that wraps", status: "error" }], 8);
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) {
			expect(row.background).toBe(1);
			expect(row.style.bold).toBe(true);
		}
	});

	it("concatenates rows across several items in order, each item's own rows first", () => {
		const rows = wrapFooterHistory(
			[
				{ role: "user", text: "hi" },
				{ role: "assistant", text: "one two three", },
			],
			6,
		);
		expect(rows.map((row) => row.text)).toEqual(["hi", "one", "two", "three"]);
	});

	it("degrades to one row per line of a single character each when maxWidth is non-positive, never throwing", () => {
		expect(() => wrapFooterHistory([{ role: "assistant", text: "hi" }], 0)).not.toThrow();
	});
});
