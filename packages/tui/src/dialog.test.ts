import { describe, expect, it } from "vitest";
import { createGridFrame, createRect, gridId, paintText, type GridFrame } from "./grid-frame.js";
import { paintDialog } from "./dialog.js";

function frameAt(width: number, height: number): GridFrame {
	const created = createGridFrame(gridId("test"), width, height);
	if (!created.ok) throw new Error(created.error.message);
	return created.value;
}

function cellAt(frame: GridFrame, x: number, y: number) {
	return frame.cells[y * frame.width + x]!;
}

describe("paintDialog", () => {
	it("centers a panel of the requested size within the whole frame", () => {
		const frame = frameAt(20, 10);
		const outcome = paintDialog(frame, ["hi"], { width: 8, height: 4 });
		expect(outcome.ok).toBe(true);
		// centeredPanelRect(20,10,8,4) => x=6,y=3
		expect(cellAt(frame, 6, 3).grapheme).toBe("┌");
		expect(cellAt(frame, 7, 4).grapheme).toBe("h");
	});

	it("floats over already-painted content instead of owning the whole viewport -- content outside the dialog area survives untouched", () => {
		const frame = frameAt(20, 10);
		const area = createRect(0, 0, 20, 10);
		if (!area.ok) throw new Error(area.error.message);
		paintText(frame, area.value, 0, 0, "background content here", {}, 0);
		const outcome = paintDialog(frame, ["hi"], { width: 8, height: 4, layer: 5 });
		expect(outcome.ok).toBe(true);
		// (0,0) is well outside the centered 8x4 dialog rect -- must still read the background text.
		expect(cellAt(frame, 0, 0).grapheme).toBe("b");
	});

	it("dims the whole frame at layer-1 when dimOverlay is set, without touching the dialog's own higher layer", () => {
		const frame = frameAt(10, 6);
		const outcome = paintDialog(frame, ["hi"], { width: 4, height: 3, layer: 5, dimOverlay: true, overlayStyle: { dim: true } });
		expect(outcome.ok).toBe(true);
		// A corner cell outside the dialog rect should have picked up the dim overlay.
		expect(cellAt(frame, 0, 0)).toMatchObject({ grapheme: " ", style: { dim: true }, layer: 4 });
		// The dialog's own border must have painted over the overlay at the higher layer.
		const dialogArea = { x: 3, y: 1 }; // centeredPanelRect(10,6,4,3) => x=3,y=1
		expect(cellAt(frame, dialogArea.x, dialogArea.y).layer).toBe(5);
	});

	it("never paints an overlay when dimOverlay is left unset", () => {
		const frame = frameAt(6, 4);
		const outcome = paintDialog(frame, [], { width: 2, height: 2 });
		expect(outcome.ok).toBe(true);
		expect(cellAt(frame, 0, 0)).toMatchObject({ grapheme: " ", layer: -1 });
	});
});
