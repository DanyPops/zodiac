import { describe, expect, it } from "vitest";
import { parseAnsiLine } from "./ansi-segments.js";

describe("parseAnsiLine", () => {
	it("returns one segment carrying the base style for a plain string with no escape codes", () => {
		expect(parseAnsiLine("hello", { foreground: 7 })).toEqual([{ text: "hello", style: { foreground: 7 } }]);
	});

	it("returns nothing for an empty string", () => {
		expect(parseAnsiLine("", { foreground: 7 })).toEqual([]);
	});

	it("splits a bold span into three segments, restoring the base style after it closes", () => {
		const line = "this is \x1b[1mbold\x1b[0m text";
		expect(parseAnsiLine(line, { foreground: 7 })).toEqual([
			{ text: "this is ", style: { foreground: 7 } },
			{ text: "bold", style: { foreground: 7, bold: true } },
			{ text: " text", style: { foreground: 7 } },
		]);
	});

	it("maps 8-color foreground/background SGR codes onto CellStyle's numeric palette", () => {
		const line = "\x1b[35mmagenta\x1b[0m \x1b[42mgreen bg\x1b[0m";
		expect(parseAnsiLine(line)).toEqual([
			{ text: "magenta", style: { foreground: 5 } },
			{ text: " ", style: {} },
			{ text: "green bg", style: { background: 2 } },
		]);
	});

	it("resolves true LIFO nesting -- an inner reset restores the still-open outer style, not the base", () => {
		// A heading wrapping bold wrapping underline, exactly as pi-tui's own theme composition emits it.
		const line = "\x1b[1;36m\x1b[1m\x1b[4mTitle\x1b[0m\x1b[0m\x1b[0m";
		expect(parseAnsiLine(line, { foreground: 7 })).toEqual([{ text: "Title", style: { foreground: 6, bold: true, underline: true } }]);
	});

	it("handles partial nesting: closing only the inner span leaves the outer style live for what follows", () => {
		const line = "a \x1b[1mbold \x1b[3mand italic\x1b[0m\x1b[0m word";
		expect(parseAnsiLine(line, { foreground: 7 })).toEqual([
			{ text: "a ", style: { foreground: 7 } },
			{ text: "bold ", style: { foreground: 7, bold: true } },
			{ text: "and italic", style: { foreground: 7, bold: true, italic: true } },
			{ text: " word", style: { foreground: 7 } },
		]);
	});

	it("treats an unmatched trailing reset as a no-op rather than throwing", () => {
		expect(() => parseAnsiLine("\x1b[0mplain\x1b[0m", { foreground: 7 })).not.toThrow();
		expect(parseAnsiLine("\x1b[0mplain\x1b[0m", { foreground: 7 })).toEqual([{ text: "plain", style: { foreground: 7 } }]);
	});

	it("clears an explicit default-foreground/background code (39/49) rather than leaving the prior color set", () => {
		const line = "\x1b[31mred\x1b[39m plain";
		expect(parseAnsiLine(line, { foreground: 7 })).toEqual([
			{ text: "red", style: { foreground: 1 } },
			{ text: " plain", style: {} },
		]);
	});
});
