import { describe, expect, it } from "vitest";
import { createGridFrame, createRect, gridId, type GridFrame } from "./grid-frame.js";
import { centeredPanelRect, paintCenteredFramedPanel, paintFramedPanel } from "./framed-panel.js";

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

describe("paintFramedPanel", () => {
	it("paints a bordered box with content clipped between the vertical borders", () => {
		const frame = frameAt(10, 5);
		const area = createRect(0, 0, 10, 5);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, ["hello", "world"]);
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 0)).toBe("┌────────┐");
		expect(rowText(frame, 1)).toBe("│hello   │");
		expect(rowText(frame, 2)).toBe("│world   │");
		expect(rowText(frame, 4)).toBe("└────────┘");
	});

	it("centers a title in the top border", () => {
		const frame = frameAt(12, 3);
		const area = createRect(0, 0, 12, 3);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, [], { title: "Menu" });
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 0)).toContain(" Menu ");
	});

	it("paints a footer separated from content by a horizontal rule", () => {
		const frame = frameAt(10, 6);
		const area = createRect(0, 0, 10, 6);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, ["one"], { footer: "esc to close" });
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 1)).toBe("│one     │");
		expect(rowText(frame, 3)).toBe("├────────┤");
		expect(rowText(frame, 4)).toBe("│esc to c│");
		expect(rowText(frame, 5)).toBe("└────────┘");
	});

	it("silently paints nothing for an area too small to hold a border", () => {
		const frame = frameAt(5, 5);
		const area = createRect(0, 0, 1, 1);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, ["x"]);
		expect(outcome.ok).toBe(true);
		expect(frame.cells.every((cell) => cell.grapheme === " ")).toBe(true);
	});

	it("clips content and footer text to the interior width -- never overwrites the right border column", () => {
		const frame = frameAt(10, 5);
		const area = createRect(0, 0, 10, 5);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, ["this line is much too wide to fit"], { footer: "also much too wide to fit here" });
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 1)).toBe("│this lin│");
	});

	it("never throws when content lines outnumber the available rows -- extras are simply not painted", () => {
		const frame = frameAt(10, 3);
		const area = createRect(0, 0, 10, 3);
		if (!area.ok) throw new Error(area.error.message);
		const outcome = paintFramedPanel(frame, area.value, ["a", "b", "c", "d"]);
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 1)).toBe("│a       │");
	});
});

describe("centeredPanelRect / paintCenteredFramedPanel", () => {
	it("centers a smaller panel within a larger frame", () => {
		const rect = centeredPanelRect(20, 10, 10, 4);
		expect(rect).toMatchObject({ ok: true, value: { x: 5, y: 3, width: 10, height: 4 } });
	});

	it("clamps to the frame's own size when the requested panel is larger than the frame", () => {
		const rect = centeredPanelRect(6, 4, 20, 20);
		expect(rect).toMatchObject({ ok: true, value: { x: 0, y: 0, width: 6, height: 4 } });
	});

	it("paints the panel at its own centered position on a real frame", () => {
		const frame = frameAt(10, 6);
		const outcome = paintCenteredFramedPanel(frame, 10, 6, 6, 4, ["hi"]);
		expect(outcome.ok).toBe(true);
		expect(rowText(frame, 1)).toBe("  ┌────┐  ");
		expect(rowText(frame, 2)).toBe("  │hi  │  ");
	});
});
