import { describe, expect, it } from "vitest";
import { wrapFooterHistory } from "./footer-history-wrap.js";

/** Concatenates a row's segments back into plain text, for tests that only care about wrapping/content, not styling. */
function rowText(row: { segments: readonly { text: string }[] }): string {
	return row.segments.map((segment) => segment.text).join("");
}

describe("wrapFooterHistory", () => {
	it("keeps a short user message on a single row, unchanged", () => {
		const rows = wrapFooterHistory([{ role: "user", text: "hi" }], 20);
		expect(rows).toEqual([{ segments: [{ text: "hi", style: { foreground: 7, background: 4 } }], background: 4 }]);
	});

	it("word-wraps a long user message across multiple rows instead of truncating it", () => {
		const rows = wrapFooterHistory([{ role: "user", text: "one two three four five six" }], 10);
		expect(rows.map(rowText)).toEqual(["one two", "three four", "five six"]);
	});

	it("hard-breaks a single word longer than the available width", () => {
		const rows = wrapFooterHistory([{ role: "user", text: "abcdefghij" }], 4);
		expect(rows.map(rowText)).toEqual(["abcd", "efgh", "ij"]);
	});

	it("splits a user message on real embedded newlines as hard breaks, never joining two logical lines onto one row", () => {
		const rows = wrapFooterHistory([{ role: "user", text: "line one\nline two" }], 20);
		expect(rows.map(rowText)).toEqual(["line one", "line two"]);
	});

	it("renders an empty assistant message as a single blank row rather than disappearing", () => {
		const rows = wrapFooterHistory([{ role: "assistant", text: "" }], 20);
		expect(rows.map(rowText)).toEqual([""]);
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
			expect(row.segments.every((segment) => segment.style.bold)).toBe(true);
		}
	});

	it("concatenates rows across several items in order, each item's own rows first", () => {
		const rows = wrapFooterHistory(
			[
				{ role: "user", text: "hi" },
				{ role: "assistant", text: "one two three" },
			],
			6,
		);
		expect(rows.map(rowText).map((text) => text.trim())).toEqual(["hi", "one", "two", "three"]);
	});

	it("degrades to something sane when maxWidth is non-positive, never throwing", () => {
		expect(() => wrapFooterHistory([{ role: "user", text: "hi" }], 0)).not.toThrow();
		expect(() => wrapFooterHistory([{ role: "assistant", text: "hi" }], 0)).not.toThrow();
	});

	describe("assistant messages render as real markdown", () => {
		it("bolds a **bold** span as its own segment, leaving the surrounding plain text unstyled", () => {
			const rows = wrapFooterHistory([{ role: "assistant", text: "this is **bold** text" }], 40);
			expect(rows).toHaveLength(1);
			const boldSegment = rows[0]!.segments.find((segment) => segment.text.trim() === "bold");
			expect(boldSegment?.style.bold).toBe(true);
			const plainSegment = rows[0]!.segments.find((segment) => segment.text.includes("this is"));
			expect(plainSegment?.style.bold).toBeFalsy();
		});

		it("renders a heading with a distinct color and bold, not as literal '#' text", () => {
			const rows = wrapFooterHistory([{ role: "assistant", text: "# Title" }], 40);
			const text = rowText(rows[0]!);
			expect(text).not.toContain("#");
			expect(text).toContain("Title");
			const titleSegment = rows[0]!.segments.find((segment) => segment.text.includes("Title"));
			expect(titleSegment?.style.bold).toBe(true);
		});

		it("styles an inline code span distinctly from surrounding prose", () => {
			const rows = wrapFooterHistory([{ role: "assistant", text: "use `foo()` here" }], 40);
			const codeSegment = rows[0]!.segments.find((segment) => segment.text === "foo()");
			expect(codeSegment).toBeDefined();
			expect(codeSegment?.style).not.toEqual(rows[0]!.segments[0]?.style);
		});

		it("renders a fenced code block across its own rows without throwing on an unclosed fence (mid-stream)", () => {
			expect(() => wrapFooterHistory([{ role: "assistant", text: "```js\nconst x =" }], 40)).not.toThrow();
			const rows = wrapFooterHistory([{ role: "assistant", text: "```js\nconst x =" }], 40);
			expect(rows.length).toBeGreaterThan(0);
			expect(rows.map(rowText).join("\n")).toContain("const x =");
		});

		it("renders list items with a bullet, one item per row", () => {
			const rows = wrapFooterHistory([{ role: "assistant", text: "- one\n- two" }], 40);
			const texts = rows.map((row) => rowText(row).trim());
			expect(texts).toEqual(["- one", "- two"]);
		});

		it("does not run markdown formatting on user or tool messages -- literal asterisks stay literal", () => {
			const userRows = wrapFooterHistory([{ role: "user", text: "this is **not bold**" }], 40);
			expect(rowText(userRows[0]!)).toContain("**not bold**");
			const toolRows = wrapFooterHistory([{ role: "tool", text: "**tool**", status: "success" }], 40);
			expect(rowText(toolRows[0]!)).toContain("**tool**");
		});
	});
});
