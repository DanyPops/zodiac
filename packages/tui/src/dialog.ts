import { createRect, paintText, type CellStyle, type GridFrame, type Outcome } from "./grid-frame.js";
import { paintCenteredFramedPanel, type FramedPanelStyles } from "./framed-panel.js";
import type { BoxGlyphs } from "./glyphs.js";

/**
 * A floating modal centered within the whole frame, built on
 * `paintFramedPanel` -- the grid-native analog of `packages/ui`'s
 * `DialogChrome`, but with a capability a line-stacking TUI fundamentally
 * can't offer: it floats *over* whatever else is already painted, using
 * this package's own z-index layer system, rather than owning the entire
 * viewport the way a line-based Dialog must.
 */
export interface DialogOptions {
	readonly title?: string;
	readonly footer?: string;
	readonly width: number;
	readonly height: number;
	readonly glyphs?: BoxGlyphs;
	readonly styles?: FramedPanelStyles;
	/** z-index layer the dialog itself paints on; must exceed whatever is already on the frame. Defaults to 10. */
	readonly layer?: number;
	/** Dims the whole frame at `layer - 1` before painting the dialog, so content behind it visibly recedes. */
	readonly dimOverlay?: boolean;
	readonly overlayStyle?: CellStyle;
}

export const DEFAULT_DIALOG_LAYER = 10;

function paintDimOverlay(frame: GridFrame, style: CellStyle, layer: number): Outcome<void> {
	const area = createRect(0, 0, frame.width, frame.height);
	if (!area.ok) return area;
	const row = " ".repeat(frame.width);
	for (let y = 0; y < frame.height; y++) {
		const painted = paintText(frame, area.value, 0, y, row, style, layer);
		if (!painted.ok) return painted;
	}
	return { ok: true, value: undefined };
}

export function paintDialog(frame: GridFrame, contentLines: readonly string[], options: DialogOptions): Outcome<void> {
	const layer = options.layer ?? DEFAULT_DIALOG_LAYER;
	if (options.dimOverlay) {
		const overlay = paintDimOverlay(frame, options.overlayStyle ?? {}, Math.max(0, layer - 1));
		if (!overlay.ok) return overlay;
	}
	return paintCenteredFramedPanel(frame, frame.width, frame.height, options.width, options.height, contentLines, {
		title: options.title,
		footer: options.footer,
		glyphs: options.glyphs,
		styles: options.styles,
		layer,
	});
}
