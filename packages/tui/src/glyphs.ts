/**
 * Box-drawing characters for one rectangular frame -- the same shape as
 * Malevich's own `BoxGlyphs` (~/Projects/malevich/src/glyphs.ts), used here
 * as prior art for *which fields a box needs*, not as imported code:
 * Malevich's own file exists to support runtime theme switching across
 * multiple different host terminal SDKs (an injected `GlyphTheme` port,
 * since Malevich itself never picks a host). Zodiac authors natively
 * against its own single grid host, the same reason `frame/border.ts`
 * already inlines its junction glyphs as literals rather than going through
 * an injected theme -- no cross-host portability need exists here, so one
 * concrete, non-configurable style is the right amount of abstraction.
 */
export interface BoxGlyphs {
	readonly horizontal: string;
	readonly vertical: string;
	readonly topLeft: string;
	readonly topRight: string;
	readonly bottomLeft: string;
	readonly bottomRight: string;
	/** Junction where an internal horizontal rule (e.g. a footer separator) meets the left border. */
	readonly leftTee: string;
	/** Junction where an internal horizontal rule meets the right border. */
	readonly rightTee: string;
}

export const SINGLE_BOX_GLYPHS: BoxGlyphs = {
	horizontal: "─",
	vertical: "│",
	topLeft: "┌",
	topRight: "┐",
	bottomLeft: "└",
	bottomRight: "┘",
	leftTee: "├",
	rightTee: "┤",
};
