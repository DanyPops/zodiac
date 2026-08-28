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

	/**
	 * A real, previously-shipped bug: a real shell's own bracketed-paste-mode enable sequence
	 * (\x1b[?2004h, a DEC private mode toggle, final byte `h` not `m`) leaked as literal visible
	 * "[?2004h" text -- the old SGR-only regex simply never matched it, so the whole raw sequence
	 * fell through as plain "rest" text. Fixed at this layer (a general CSI-sequence match, with an
	 * explicit isSgr check deciding what's real styling vs. what's silently dropped) as
	 * defense-in-depth alongside native-terminal.ts's own excludeModes fix -- this test pins the
	 * parser's own contract regardless of which future caller might emit a non-SGR CSI sequence.
	 */
	it("silently drops a non-SGR CSI sequence (e.g. a DEC private mode toggle) instead of leaking it as literal text", () => {
		expect(parseAnsiLine("before\x1b[?2004hafter")).toEqual([{ text: "before", style: {} }, { text: "after", style: {} }]);
	});

	it("drops a non-SGR CSI sequence sitting between two styled spans without disturbing either span's own style", () => {
		const line = "\x1b[1mbold\x1b[?2004h\x1b[0m plain";
		expect(parseAnsiLine(line, { foreground: 7 })).toEqual([
			{ text: "bold", style: { foreground: 7, bold: true } },
			{ text: " plain", style: { foreground: 7 } },
		]);
	});

	it("still treats a real SGR sequence as styling even though the general CSI match now also covers non-SGR final bytes", () => {
		expect(parseAnsiLine("\x1b[1mbold\x1b[0m")).toEqual([{ text: "bold", style: { bold: true } }]);
	});

	it("drops complete OSC, DCS, APC, SOS, and PM control strings", () => {
		const line = [
			"a",
			"\x1b]0;window title\x07",
			"b",
			"\x1bP1;2|device payload\x1b\\",
			"c",
			"\x1b_pi:cursor\x07",
			"d",
			"\x1bXsos payload\x1b\\",
			"e",
			"\x1b^pm payload\x1b\\",
			"f",
		].join("");

		expect(parseAnsiLine(line).map((segment) => segment.text).join("")).toBe("abcdef");
	});

	it("drops an unterminated control string through the end of the row", () => {
		expect(parseAnsiLine("visible\x1b]0;unfinished title")).toEqual([{ text: "visible", style: {} }]);
	});
});
