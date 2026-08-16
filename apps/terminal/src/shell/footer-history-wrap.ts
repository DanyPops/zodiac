import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { CellStyle } from "@zodiac/tui";
import type { FooterChatItem } from "../pi/footer-chat-controller.js";
import { parseAnsiLine, type StyledSegment } from "@zodiac/tui";

// Pi TUI's own AssistantMessageComponent/UserMessageComponent/ToolExecutionComponent
// (see semantic-shell.ts's own doc comment on the same constants for the full
// citation) render role via a full-row background, never an inline text prefix.
// Duplicated here rather than imported from semantic-shell.ts to keep this
// module -- the thing that actually needs hermetic, no-GridTerminal-required
// unit tests -- free of any dependency on the shell itself.
const USER_BUBBLE_BG = 4; // blue
const TOOL_PENDING_BG = 3; // yellow
const TOOL_SUCCESS_BG = 2; // green
const TOOL_ERROR_BG = 1; // red
const BASE: CellStyle = { foreground: 7 };

/** One already-wrapped, already-styled row of Footer history -- what paintRegion actually paints, one row at a time, after windowing. */
export interface WrappedFooterRow {
	readonly segments: readonly StyledSegment[];
	readonly background?: number;
}

function sgr(codes: string, text: string): string {
	return `\x1b[${codes}m${text}\x1b[0m`;
}

/**
 * Maps pi-tui's own MarkdownTheme hooks onto real SGR escape codes, scoped
 * to exactly the numeric space grid-terminal.ts's styleSequence() already
 * commits to project-wide (plain 8-color 30-37/40-47, bold/dim/italic/
 * underline/inverse as 1/2/3/4/7) -- ansi-segments.ts's parseAnsiLine()
 * reads this same space back out into real CellStyle segments afterward.
 * strikethrough has no CellStyle field to render it with at all; dim is
 * the closest available approximation rather than silently dropping it.
 */
const FOOTER_MARKDOWN_THEME: MarkdownTheme = {
	heading: (text) => sgr("1;36", text),
	link: (text) => sgr("4;34", text),
	linkUrl: (text) => sgr("2;34", text),
	code: (text) => sgr("35", text),
	codeBlock: (text) => sgr("2", text),
	codeBlockBorder: (text) => sgr("2", text),
	quote: (text) => sgr("2;3", text),
	quoteBorder: (text) => sgr("2", text),
	hr: (text) => sgr("2", text),
	listBullet: (text) => sgr("33", text),
	bold: (text) => sgr("1", text),
	italic: (text) => sgr("3", text),
	strikethrough: (text) => sgr("2", text),
	underline: (text) => sgr("4", text),
};

/**
 * Greedy word-wrap: breaks at the rightmost space at or before `maxWidth`,
 * falling back to a hard break exactly at `maxWidth` when no such space
 * exists (a single word/token longer than the available width -- e.g. a
 * long tool-call argument with no spaces at all). Embedded `\n` is always a
 * hard break, wrapped independently -- this is the thing the old
 * one-row-per-item truncation could never do at all, since it only ever
 * showed the tail of a single flattened string.
 */
function wrapLine(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [""];
	const rows: string[] = [];
	let remaining = text;
	while (remaining.length > maxWidth) {
		let breakAt = remaining.lastIndexOf(" ", maxWidth);
		if (breakAt <= 0) breakAt = maxWidth;
		rows.push(remaining.slice(0, breakAt).trimEnd());
		remaining = remaining.slice(breakAt).trimStart();
	}
	rows.push(remaining);
	return rows;
}

/** Splits on real newlines first (hard breaks), then word-wraps each resulting line independently -- an empty string still produces exactly one (blank) row, so an empty message doesn't just disappear from the history. */
function wrapText(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [""];
	const hardLines = text.split("\n");
	const rows = hardLines.flatMap((line) => wrapLine(line, maxWidth));
	return rows.length > 0 ? rows : [""];
}

function plainRow(text: string, style: CellStyle, background?: number): WrappedFooterRow {
	return { segments: [{ text, style }], background };
}

/**
 * Renders one assistant message as real Markdown -- headings, emphasis,
 * inline/block code, lists, links, quotes, rules, tables -- by handing the
 * raw text to pi-tui's own `Markdown` component (the same one Pi's real
 * interactive mode renders its own transcript with) rather than
 * reimplementing GFM parsing/wrapping/table-layout locally. That component
 * only ever speaks ANSI-styled strings, not this project's own CellStyle;
 * `FOOTER_MARKDOWN_THEME` bridges that by emitting real SGR codes, and
 * `parseAnsiLine` reads them back into styled segments afterward.
 *
 * Safe to call on partial/streaming markdown (an unclosed code fence,
 * a "**bold" with no closing marker yet): confirmed live against pi-tui's
 * own renderer, which degrades gracefully rather than throwing, the same
 * as Pi's own TUI re-rendering a growing assistant message token by token.
 *
 * `Markdown.render(width)` already word-wraps to the given width using its
 * own layout logic (list indenting, code-block fencing, table columns) --
 * wrapping its *output* again with this file's own wrapText would only
 * risk splitting an emitted ANSI escape sequence in half, so this never
 * runs that path.
 */
function markdownRows(text: string, maxWidth: number): WrappedFooterRow[] {
	const rendered = new Markdown(text, 0, 0, FOOTER_MARKDOWN_THEME).render(Math.max(1, maxWidth));
	// A genuinely empty message renders as zero lines, not one blank one --
	// preserve the "still shows as a row" guarantee plain wrapText gives.
	if (rendered.length === 0) return [plainRow("", BASE)];
	return rendered.map((line) => ({ segments: parseAnsiLine(line, BASE) }));
}

/**
 * Turns the Footer's real conversation history into a flat, already-wrapped
 * row buffer -- the "wrap" half of the wrap-then-window pattern shared by
 * tmux's own scrollback, pi-tui's ScrollView (`follow: "end"`), and
 * opentui's ScrollBox (`stickyScroll`/`stickyStart: "bottom"`). Windowing
 * (picking which slice of this array to actually show, given a scroll
 * offset and however many rows the current viewport has) is the caller's
 * job (SemanticShell.paintRegion) -- this only ever wraps, never truncates
 * or drops content, so nothing scrolled past is ever unrecoverable.
 */
export function wrapFooterHistory(items: readonly FooterChatItem[], maxWidth: number): WrappedFooterRow[] {
	const rows: WrappedFooterRow[] = [];
	for (const item of items) {
		if (item.role === "user") {
			const style: CellStyle = { foreground: 7, background: USER_BUBBLE_BG };
			for (const text of wrapText(item.text, maxWidth)) rows.push(plainRow(text, style, USER_BUBBLE_BG));
			continue;
		}
		if (item.role === "assistant") {
			rows.push(...markdownRows(item.text, maxWidth));
			continue;
		}
		const background = item.status === "pending" ? TOOL_PENDING_BG : item.status === "success" ? TOOL_SUCCESS_BG : TOOL_ERROR_BG;
		const style: CellStyle = { foreground: 7, background, bold: true };
		for (const text of wrapText(item.text, maxWidth)) rows.push(plainRow(text, style, background));
	}
	return rows;
}
