import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { mountComponent } from "./component-mount.js";
import { createGridFrame, createRect, gridId, type CellStyle, type GridFrame } from "../frame/index.js";

function frameAt(width: number, height: number): GridFrame {
	const created = createGridFrame(gridId("test"), width, height);
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

function cellAt(frame: GridFrame, x: number, y: number): { grapheme: string; style: CellStyle } {
	const cell = frame.cells[y * frame.width + x]!;
	return { grapheme: cell.grapheme, style: cell.style };
}

function componentRendering(lines: string[]): Component {
	return { render: () => lines, invalidate: () => {} };
}

describe("mountComponent", () => {
	it("paints a plain, unstyled Component's rows verbatim", () => {
		const frame = frameAt(20, 5);
		const area = createRect(0, 0, 20, 5);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = mountComponent(frame, area.value, componentRendering(["hello", "world"]));
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 0, 0).grapheme).toBe("h");
		expect(cellAt(frame, 4, 0).grapheme).toBe("o");
		expect(cellAt(frame, 0, 1).grapheme).toBe("w");
	});

	it("recovers inverse:true from a literal \\x1b[7m...\\x1b[0m cursor cell -- pi-lector's NeovimEditorComponent's own cursor convention", () => {
		const frame = frameAt(20, 5);
		const area = createRect(0, 0, 20, 5);
		if (!area.ok) throw new Error(area.error.message);
		const line = `ab\x1b[7mc\x1b[0mde`;
		const outcome = mountComponent(frame, area.value, componentRendering([line]));
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 0, 0)).toMatchObject({ grapheme: "a", style: {} });
		expect(cellAt(frame, 1, 0)).toMatchObject({ grapheme: "b", style: {} });
		expect(cellAt(frame, 2, 0)).toMatchObject({ grapheme: "c", style: { inverse: true } });
		expect(cellAt(frame, 3, 0)).toMatchObject({ grapheme: "d", style: {} });
	});

	it("tracks a moving cursor across frames, exactly as a real interactive session re-renders on every keystroke", () => {
		const frame = frameAt(10, 1);
		const area = createRect(0, 0, 10, 1);
		if (!area.ok) throw new Error(area.error.message);

		mountComponent(frame, area.value, componentRendering([`\x1b[7mX\x1b[0mbbbbbbbbb`]));
		expect(cellAt(frame, 0, 0).style.inverse).toBe(true);
		expect(cellAt(frame, 1, 0).style.inverse).toBeUndefined();

		mountComponent(frame, area.value, componentRendering([`a\x1b[7mX\x1b[0mbbbbbbbb`]));
		expect(cellAt(frame, 0, 0).style.inverse).toBeUndefined();
		expect(cellAt(frame, 1, 0).style.inverse).toBe(true);
	});

	it("mounted at the full terminal (100%/100% overlay) paints every row and column without error", () => {
		const width = 160;
		const height = 40;
		const frame = frameAt(width, height);
		const area = createRect(0, 0, width, height);
		if (!area.ok) throw new Error(area.error.message);
		const lines = Array.from({ length: height }, (_, y) => "x".repeat(width) + (y === 0 ? "" : ""));
		const outcome = mountComponent(frame, area.value, componentRendering(lines));
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 0, 0).grapheme).toBe("x");
		expect(cellAt(frame, width - 1, height - 1).grapheme).toBe("x");
	});

	it("safely clips a Component that renders more rows or wider text than the given area, never throwing or erroring", () => {
		const frame = frameAt(5, 2);
		const area = createRect(0, 0, 5, 2);
		if (!area.ok) throw new Error(area.error.message);
		const tooWide = "x".repeat(50);
		const outcome = mountComponent(frame, area.value, componentRendering([tooWide, tooWide, tooWide, tooWide]));
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 4, 1).grapheme).toBe("x");
	});

	it("mounts into a sub-rect, not just the whole frame -- offsets every row/column by the area's own origin", () => {
		const frame = frameAt(10, 10);
		const area = createRect(3, 4, 4, 2);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = mountComponent(frame, area.value, componentRendering(["ab", "cd"]));
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 3, 4).grapheme).toBe("a");
		expect(cellAt(frame, 4, 4).grapheme).toBe("b");
		expect(cellAt(frame, 3, 5).grapheme).toBe("c");
	});
});
