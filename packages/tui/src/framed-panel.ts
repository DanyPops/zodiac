import { createRect, paintText, type CellStyle, type GridFrame, type Outcome, type Rect } from "./grid-frame.js";
import { SINGLE_BOX_GLYPHS, type BoxGlyphs } from "./glyphs.js";

/**
 * The border+title+content+footer scaffold shared by Dialog and
 * BorderedSelectPanel -- the grid-native analog of Malevich's own
 * `framed-panel.ts`, which plays the identical role for Dialog/Menu/
 * BorderedSelectPanel there ("previously hand-rolled once per component
 * with a slightly different line order in each"). Ported as a *shape*, not
 * as code: Malevich's own version assembles pre-measured/pre-styled
 * *string lines* for a line-stacking host; this one paints directly into
 * an arbitrary (x,y) `Rect` of a `GridFrame`, since that's the whole reason
 * this package exists instead of depending on Malevich's own line-based
 * Component contract.
 */
export interface FramedPanelStyles {
	readonly border: CellStyle;
	readonly title?: CellStyle;
	readonly content?: CellStyle;
	readonly footer?: CellStyle;
}

export interface PaintFramedPanelOptions {
	readonly title?: string;
	readonly footer?: string;
	readonly glyphs?: BoxGlyphs;
	readonly styles?: FramedPanelStyles;
	/** z-index layer every painted cell lands on; defaults to 0. */
	readonly layer?: number;
}

const DEFAULT_STYLES: FramedPanelStyles = { border: {} };

function centeredLabel(available: number, label: string): { text: string; offset: number } | undefined {
	if (available <= 2) return undefined;
	const text = ` ${label} `.slice(0, available);
	return { text, offset: Math.max(0, Math.floor((available - text.length) / 2)) };
}

/**
 * Paints a bordered box into `area`: a top border (with an optional
 * centered title), `contentLines` clipped to the space between the
 * vertical borders, an optional footer separated by a horizontal rule, and
 * a bottom border. Returns `ok: true` without painting anything for an
 * area too small to hold a border (width or height below 2) -- the same
 * "nothing sensible to draw, silently skip" contract `surface-tiles.ts`'s
 * own `paintSurfaceBox` already established for a zero-area placement.
 */
export function paintFramedPanel(frame: GridFrame, area: Rect, contentLines: readonly string[], options: PaintFramedPanelOptions = {}): Outcome<void> {
	if (area.width < 2 || area.height < 2) return { ok: true, value: undefined };
	const glyphs = options.glyphs ?? SINGLE_BOX_GLYPHS;
	const styles = options.styles ?? DEFAULT_STYLES;
	const layer = options.layer ?? 0;
	const hasFooter = options.footer !== undefined && area.height >= 4;

	const topLine = glyphs.topLeft + glyphs.horizontal.repeat(Math.max(0, area.width - 2)) + (area.width > 1 ? glyphs.topRight : "");
	const top = paintText(frame, area, 0, 0, topLine, styles.border, layer);
	if (!top.ok) return top;

	const bottomRow = area.height - 1;
	const bottomLine = glyphs.bottomLeft + glyphs.horizontal.repeat(Math.max(0, area.width - 2)) + (area.width > 1 ? glyphs.bottomRight : "");
	const bottom = paintText(frame, area, 0, bottomRow, bottomLine, styles.border, layer);
	if (!bottom.ok) return bottom;

	if (options.title) {
		const label = centeredLabel(area.width - 2, options.title);
		if (label) {
			const painted = paintText(frame, area, 1 + label.offset, 0, label.text, styles.title ?? styles.border, layer);
			if (!painted.ok) return painted;
		}
	}

	const separatorRow = hasFooter ? bottomRow - 2 : -1;
	const footerRow = hasFooter ? bottomRow - 1 : -1;
	const contentBottom = hasFooter ? separatorRow - 1 : bottomRow - 1;

	for (let y = 1; y <= contentBottom; y++) {
		const left = paintText(frame, area, 0, y, glyphs.vertical, styles.border, layer);
		if (!left.ok) return left;
		if (area.width > 1) {
			const right = paintText(frame, area, area.width - 1, y, glyphs.vertical, styles.border, layer);
			if (!right.ok) return right;
		}
		const line = contentLines[y - 1];
		if (line !== undefined && area.width > 2) {
			const painted = paintText(frame, area, 1, y, line.slice(0, area.width - 2), styles.content ?? styles.border, layer);
			if (!painted.ok) return painted;
		}
	}

	if (hasFooter) {
		const separatorLine = glyphs.leftTee + glyphs.horizontal.repeat(Math.max(0, area.width - 2)) + (area.width > 1 ? glyphs.rightTee : "");
		const separator = paintText(frame, area, 0, separatorRow, separatorLine, styles.border, layer);
		if (!separator.ok) return separator;

		const left = paintText(frame, area, 0, footerRow, glyphs.vertical, styles.border, layer);
		if (!left.ok) return left;
		if (area.width > 1) {
			const right = paintText(frame, area, area.width - 1, footerRow, glyphs.vertical, styles.border, layer);
			if (!right.ok) return right;
		}
		if (options.footer && area.width > 2) {
			const painted = paintText(frame, area, 1, footerRow, options.footer.slice(0, area.width - 2), styles.footer ?? styles.border, layer);
			if (!painted.ok) return painted;
		}
	}

	return { ok: true, value: undefined };
}

/**
 * The `Rect` a `panelWidth`x`panelHeight` panel occupies when centered
 * within a `frameWidth`x`frameHeight` frame, clamped to fit. Exported
 * separately from `paintCenteredFramedPanel` so a caller that needs
 * per-row styling beyond one shared `contentLines` style (e.g.
 * `BorderedSelectPanel` highlighting one row) can paint the chrome via
 * `paintFramedPanel` and its own content rows directly into the same area,
 * without duplicating this centering math.
 */
export function centeredPanelRect(frameWidth: number, frameHeight: number, panelWidth: number, panelHeight: number): Outcome<Rect> {
	const clampedWidth = Math.min(panelWidth, frameWidth);
	const clampedHeight = Math.min(panelHeight, frameHeight);
	const x = Math.max(0, Math.floor((frameWidth - clampedWidth) / 2));
	const y = Math.max(0, Math.floor((frameHeight - clampedHeight) / 2));
	return createRect(x, y, clampedWidth, clampedHeight);
}

/** Convenience: builds and validates the `Rect` for a panel centered within a `width`x`height` frame, then paints it. */
export function paintCenteredFramedPanel(
	frame: GridFrame,
	frameWidth: number,
	frameHeight: number,
	panelWidth: number,
	panelHeight: number,
	contentLines: readonly string[],
	options: PaintFramedPanelOptions = {},
): Outcome<void> {
	const area = centeredPanelRect(frameWidth, frameHeight, panelWidth, panelHeight);
	if (!area.ok) return area;
	return paintFramedPanel(frame, area.value, contentLines, options);
}
