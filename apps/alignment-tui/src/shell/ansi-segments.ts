import type { CellStyle } from "../frame/index.js";

/** One contiguous run of text sharing exactly one CellStyle. */
export interface StyledSegment {
	readonly text: string;
	readonly style: CellStyle;
}

const SGR_RE = /\x1b\[([\d;]*)m/g;

/**
 * Folds one SGR parameter list onto a style, in the standard numeric space
 * grid-terminal.ts's own styleSequence() already commits to project-wide:
 * bold/dim/italic/underline/inverse as 1/2/3/4/7 (with their real "off"
 * counterparts 22/23/24/27, and 39/49 clearing fore/background), plus plain
 * 8-color 30-37 / 40-47. Anything outside that space (256-color, truecolor,
 * strikethrough's real SGR 9 -- CellStyle has no field for it) is silently
 * ignored rather than misread, since nothing on the paint side of this
 * project can represent it anyway.
 */
function applyCodes(style: CellStyle, codes: readonly number[]): CellStyle {
	const next: { -readonly [K in keyof CellStyle]?: CellStyle[K] } = { ...style };
	for (const code of codes) {
		switch (code) {
			case 1:
				next.bold = true;
				break;
			case 2:
				next.dim = true;
				break;
			case 3:
				next.italic = true;
				break;
			case 4:
				next.underline = true;
				break;
			case 7:
				next.inverse = true;
				break;
			case 22:
				next.bold = false;
				next.dim = false;
				break;
			case 23:
				next.italic = false;
				break;
			case 24:
				next.underline = false;
				break;
			case 27:
				next.inverse = false;
				break;
			case 39:
				delete next.foreground;
				break;
			case 49:
				delete next.background;
				break;
			default:
				if (code >= 30 && code <= 37) next.foreground = code - 30;
				else if (code >= 40 && code <= 47) next.background = code - 40;
		}
	}
	return next;
}

/**
 * Parses a string containing embedded SGR escape sequences (`\x1b[...m`)
 * into a flat run of styled segments -- e.g. the output of pi-tui's own
 * `Markdown.render(width)`, which wraps its themed spans in real ANSI, not
 * some structured token the caller could read directly.
 *
 * Modeled as a real stack, not a single running style reset to `base` on
 * every bare `\x1b[0m`: pi-tui's theme functions each fully wrap only their
 * own substring (`open + text + \x1b[0m`), so nested markdown (bold inside
 * a heading, italic inside bold, ...) round-trips as literal open/close
 * pairs in the string -- e.g. a heading emits
 * `\x1b[1;36m\x1b[1m\x1b[4mTitle\x1b[0m\x1b[0m\x1b[0m`. A flat "reset to
 * base" model would lose the outer heading style the instant the
 * innermost span closed; the stack instead pops exactly one applied layer
 * per bare reset, so it lands back on whatever styling was still open one
 * level up -- true LIFO nesting, verified against pi-mono's own Markdown
 * component live.
 */
export function parseAnsiLine(line: string, base: CellStyle = {}): StyledSegment[] {
	const segments: StyledSegment[] = [];
	const stack: (readonly number[])[] = [];
	const currentStyle = (): CellStyle => stack.reduce((style: CellStyle, codes) => applyCodes(style, codes), base);

	SGR_RE.lastIndex = 0;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SGR_RE.exec(line))) {
		const text = line.slice(lastIndex, match.index);
		if (text.length > 0) segments.push({ text, style: currentStyle() });
		const codesText = match[1] ?? "";
		const codes = codesText === "" ? [0] : codesText.split(";").map(Number);
		if (codes.length === 1 && codes[0] === 0) stack.pop();
		else stack.push(codes);
		lastIndex = SGR_RE.lastIndex;
	}
	const rest = line.slice(lastIndex);
	if (rest.length > 0) segments.push({ text: rest, style: currentStyle() });
	return segments;
}
