import { describe, expect, it } from "vitest";
import { createGridFrame, gridId, type GridFrame } from "./grid-frame.js";
import { BorderedSelectPanel, type BorderedSelectPanelItem } from "./bordered-select-panel.js";

function frameAt(width: number, height: number): GridFrame {
	const created = createGridFrame(gridId("test"), width, height);
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

function rowText(frame: GridFrame, y: number): string {
	let text = "";
	for (let x = 0; x < frame.width; x++) text += frame.cells[y * frame.width + x]?.grapheme ?? "";
	return text;
}

const ITEMS: BorderedSelectPanelItem<string>[] = [
	{ id: "a", label: "Alpha", value: "alpha" },
	{ id: "b", label: "Beta", value: "beta", disabled: true },
	{ id: "c", label: "Gamma", value: "gamma" },
];

describe("BorderedSelectPanel", () => {
	it("highlights the first enabled item on setItems", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems(ITEMS);
		expect(panel.getHighlightedItem()?.id).toBe("a");
	});

	it("moves the highlight down, skipping a disabled item", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems(ITEMS);
		expect(panel.handleInput("\x1b[B")).toEqual({ type: "navigated" });
		expect(panel.getHighlightedItem()?.id).toBe("c");
	});

	it("wraps around when moving up from the first item", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems(ITEMS);
		panel.handleInput("\x1b[A");
		expect(panel.getHighlightedItem()?.id).toBe("c");
	});

	it("selects the highlighted item on Enter", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems(ITEMS);
		expect(panel.handleInput("\r")).toEqual({ type: "select", item: ITEMS[0] });
	});

	it("never selects a disabled item even if it were somehow highlighted", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems([ITEMS[1]!]);
		expect(panel.handleInput("\r")).toEqual({ type: "unhandled" });
	});

	it("reports cancel on Escape and Ctrl+C", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		expect(panel.handleInput("\x1b")).toEqual({ type: "cancel" });
		expect(panel.handleInput("\x03")).toEqual({ type: "cancel" });
	});

	it("accumulates a query character by character and supports backspace, only when showQueryInput is set", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8, showQueryInput: true });
		expect(panel.handleInput("a")).toEqual({ type: "query-changed", query: "a" });
		expect(panel.handleInput("b")).toEqual({ type: "query-changed", query: "ab" });
		expect(panel.handleInput("\x7f")).toEqual({ type: "query-changed", query: "a" });
		expect(panel.getQuery()).toBe("a");
	});

	it("ignores printable characters entirely when showQueryInput is not set", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		expect(panel.handleInput("a")).toEqual({ type: "unhandled" });
		expect(panel.getQuery()).toBe("");
	});

	it("re-clamps highlight to the first enabled item when setItems shrinks past the previous index", () => {
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 8 });
		panel.setItems(ITEMS);
		panel.handleInput("\x1b[B"); // now on "c" (index 2)
		panel.setItems([ITEMS[0]!]);
		expect(panel.getHighlightedItem()?.id).toBe("a");
	});

	it("paints the query line, then each item with a '> ' prefix on the highlighted row", () => {
		const frame = frameAt(20, 10);
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 10, showQueryInput: true, title: "Pick" });
		panel.setItems(ITEMS);
		const outcome = panel.paint(frame);
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 0)).toContain(" Pick ");
		expect(rowText(frame, 1)).toContain("> ");
		expect(rowText(frame, 2)).toContain("> Alpha");
		expect(rowText(frame, 3)).toContain("  Beta");
		expect(rowText(frame, 4)).toContain("  Gamma");
	});

	it("paints the empty message when there are no items", () => {
		const frame = frameAt(20, 10);
		const panel = new BorderedSelectPanel<string>({ width: 20, height: 10, emptyMessage: "Nothing found" });
		panel.setItems([]);
		const outcome = panel.paint(frame);
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 1)).toContain("Nothing found");
	});
});
