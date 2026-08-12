import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { paintText, type GridFrame, type Outcome, type Rect } from "../frame/index.js";
import { parseAnsiLine } from "./ansi-segments.js";

/**
 * Mounts an arbitrary pi-tui `Component` into a `GridFrame` region by
 * calling `component.render(area.width)` and painting each returned row's
 * ANSI-styled segments via `parseAnsiLine` -- the same per-row
 * segment-painting technique semantic-shell.ts's footer-history branch
 * already uses for Markdown rows, generalized from "rows produced by
 * wrapFooterHistory" to "rows produced by any real `Component.render()`".
 *
 * This is the whole trick that lets an extension-mounted Component (e.g.
 * pi-lector's `ModalEditorComponent`, shown via
 * `ExtensionUIContext.custom()`) actually get pixels onto Zodiac's own
 * cell grid: it renders itself exactly as it would for a real pi-tui `TUI`
 * (plain strings with embedded SGR escapes), and this adapter is the only
 * piece that needs to know both that convention and Zodiac's own grid
 * model -- the Component itself never does.
 *
 * `paintText` already clips per cell against both the frame's real bounds
 * and `area` (see its own `withinFrame`/`withinRect` checks), so a
 * Component rendering more rows or wider text than `area` provides is
 * silently truncated, never an error -- the `y < area.height` guard here is
 * a cheap early exit, not a correctness requirement.
 */
export function mountComponent(frame: GridFrame, area: Rect, component: Component): Outcome<void> {
	const lines = component.render(area.width);
	for (let y = 0; y < lines.length && y < area.height; y++) {
		const line = lines[y] ?? "";
		let x = 0;
		for (const segment of parseAnsiLine(line)) {
			if (x >= area.width) break;
			const painted = paintText(frame, area, x, y, segment.text, segment.style, 0);
			if (!painted.ok) return painted;
			x += visibleWidth(segment.text);
		}
	}
	return { ok: true, value: undefined };
}
