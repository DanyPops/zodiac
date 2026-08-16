import { paintText, type CellStyle, type GridFrame, type Outcome } from "./grid-frame.js";
import { centeredPanelRect, paintFramedPanel, type FramedPanelStyles } from "./framed-panel.js";
import type { BoxGlyphs } from "./glyphs.js";

/**
 * The grid-native analog of `packages/ui`'s `<Picker>` and Malevich's own
 * `BorderedSelectPanel` ("hand-rolled independently in five codebases" --
 * that doc comment's own evidence is why this shape is worth building
 * before Zodiac has its own in-repo duplication; see task 743725e1's own
 * explicit, acknowledged exception to this session's "extract after
 * duplication" rule).
 *
 * Unlike Malevich's version (a pure chrome wrapper delegating all
 * selection/filtering logic to a host-supplied list Component), this one
 * owns highlight/query state itself -- there is no separate "host SelectList"
 * concept in this package yet, and a stateful class is the natural shape for
 * a grid-native widget that must react to raw key bytes across renders the
 * way `GridTerminal` already does.
 *
 * Ownership split, mirroring `Picker<T>`'s own established contract: this
 * class owns highlight movement, raw query-character accumulation, and
 * painting. The *caller* still owns actually filtering items against the
 * current query (via `getQuery()` + `setItems()`) -- this never filters on
 * its own, so a caller's own fuzzy/substring/whatever matching policy is
 * never second-guessed here.
 */
export interface BorderedSelectPanelItem<T> {
	readonly id: string;
	readonly label: string;
	readonly value: T;
	readonly disabled?: boolean;
}

export interface BorderedSelectPanelStyles extends FramedPanelStyles {
	readonly item?: CellStyle;
	readonly highlightedItem?: CellStyle;
	readonly disabledItem?: CellStyle;
}

export interface BorderedSelectPanelOptions {
	readonly title?: string;
	readonly width: number;
	readonly height: number;
	readonly showQueryInput?: boolean;
	readonly emptyMessage?: string;
	readonly glyphs?: BoxGlyphs;
	readonly styles?: BorderedSelectPanelStyles;
	readonly layer?: number;
}

export type BorderedSelectPanelInputResult<T> =
	| { readonly type: "query-changed"; readonly query: string }
	| { readonly type: "select"; readonly item: BorderedSelectPanelItem<T> }
	| { readonly type: "cancel" }
	| { readonly type: "navigated" }
	| { readonly type: "unhandled" };

const UP_KEYS = new Set(["\x1b[A", "\x1bOA"]);
const DOWN_KEYS = new Set(["\x1b[B", "\x1bOB"]);

export class BorderedSelectPanel<T> {
	private items: readonly BorderedSelectPanelItem<T>[] = [];
	private highlightedIndex = 0;
	private query = "";

	constructor(private readonly options: BorderedSelectPanelOptions) {}

	/** Replaces the currently displayed items -- the caller's own responsibility to have already filtered them against `getQuery()`. Highlight moves to the first enabled item if the previous index is now out of range or disabled. */
	setItems(items: readonly BorderedSelectPanelItem<T>[]): void {
		this.items = items;
		if (this.highlightedIndex >= items.length || items[this.highlightedIndex]?.disabled) {
			this.highlightedIndex = items.findIndex((item) => !item.disabled);
			if (this.highlightedIndex < 0) this.highlightedIndex = 0;
		}
	}

	getQuery(): string {
		return this.query;
	}

	getHighlightedItem(): BorderedSelectPanelItem<T> | undefined {
		return this.items[this.highlightedIndex];
	}

	/**
	 * Consumes one raw input chunk. Escape/Ctrl+C cancels; Enter selects the
	 * highlighted (non-disabled) item; Up/Down move the highlight, skipping
	 * disabled items; any other printable character is appended to the query
	 * (only when `showQueryInput`), backspace removes the last one. Everything
	 * else is reported `unhandled` so a caller can still act on it.
	 */
	handleInput(data: string): BorderedSelectPanelInputResult<T> {
		if (data === "\x1b" || data === "\x03") return { type: "cancel" };
		if (data === "\r" || data === "\n") {
			const item = this.items[this.highlightedIndex];
			if (item && !item.disabled) return { type: "select", item };
			return { type: "unhandled" };
		}
		if (UP_KEYS.has(data)) {
			this.moveHighlight(-1);
			return { type: "navigated" };
		}
		if (DOWN_KEYS.has(data)) {
			this.moveHighlight(1);
			return { type: "navigated" };
		}
		if (this.options.showQueryInput) {
			if (data === "\x7f" || data === "\b") {
				if (this.query.length === 0) return { type: "unhandled" };
				this.query = this.query.slice(0, -1);
				return { type: "query-changed", query: this.query };
			}
			if (data.length === 1 && data >= " " && data !== "\x7f") {
				this.query += data;
				return { type: "query-changed", query: this.query };
			}
		}
		return { type: "unhandled" };
	}

	private moveHighlight(delta: number): void {
		if (this.items.length === 0) return;
		let next = this.highlightedIndex;
		for (let step = 0; step < this.items.length; step++) {
			next = (next + delta + this.items.length) % this.items.length;
			if (!this.items[next]?.disabled) {
				this.highlightedIndex = next;
				return;
			}
		}
	}

	/** Paints the panel centered within `frame`. */
	paint(frame: GridFrame): Outcome<void> {
		const layer = this.options.layer ?? 0;
		const area = centeredPanelRect(frame.width, frame.height, this.options.width, this.options.height);
		if (!area.ok) return area;

		const chrome = paintFramedPanel(frame, area.value, [], { title: this.options.title, glyphs: this.options.glyphs, styles: this.options.styles, layer });
		if (!chrome.ok) return chrome;

		let row = 1;
		const contentBottom = area.value.height - 2;
		const interiorWidth = Math.max(0, area.value.width - 2);
		const styles: BorderedSelectPanelStyles = this.options.styles ?? { border: {} };

		if (this.options.showQueryInput && row <= contentBottom) {
			const painted = paintText(frame, area.value, 1, row, `> ${this.query}`.slice(0, interiorWidth), styles.item ?? {}, layer);
			if (!painted.ok) return painted;
			row++;
		}

		if (this.items.length === 0) {
			if (row <= contentBottom) {
				const painted = paintText(frame, area.value, 1, row, (this.options.emptyMessage ?? "No results").slice(0, interiorWidth), styles.item ?? {}, layer);
				if (!painted.ok) return painted;
			}
			return { ok: true, value: undefined };
		}

		for (let index = 0; index < this.items.length && row <= contentBottom; index++, row++) {
			const item = this.items[index];
			if (!item) continue;
			const style = item.disabled ? (styles.disabledItem ?? styles.item ?? {}) : index === this.highlightedIndex ? (styles.highlightedItem ?? styles.item ?? {}) : (styles.item ?? {});
			const prefix = index === this.highlightedIndex ? "> " : "  ";
			const painted = paintText(frame, area.value, 1, row, `${prefix}${item.label}`.slice(0, interiorWidth), style, layer);
			if (!painted.ok) return painted;
		}
		return { ok: true, value: undefined };
	}
}
