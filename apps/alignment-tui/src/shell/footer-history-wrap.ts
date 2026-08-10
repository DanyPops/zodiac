import type { CellStyle } from "../frame/index.js";
import type { FooterChatItem } from "../pi/footer-chat-controller.js";

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
	readonly text: string;
	readonly style: CellStyle;
	readonly background?: number;
}

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
			for (const text of wrapText(item.text, maxWidth)) rows.push({ text, style, background: USER_BUBBLE_BG });
			continue;
		}
		if (item.role === "assistant") {
			for (const text of wrapText(item.text, maxWidth)) rows.push({ text, style: BASE });
			continue;
		}
		const background = item.status === "pending" ? TOOL_PENDING_BG : item.status === "success" ? TOOL_SUCCESS_BG : TOOL_ERROR_BG;
		const style: CellStyle = { foreground: 7, background, bold: true };
		for (const text of wrapText(item.text, maxWidth)) rows.push({ text, style, background });
	}
	return rows;
}
