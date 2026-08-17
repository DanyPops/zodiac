/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useResizeHandle } from "./useResizeHandle.js";

function fakePointerDown(clientX: number): React.PointerEvent {
	return { clientX, preventDefault: () => {} } as unknown as React.PointerEvent;
}

describe("useResizeHandle", () => {
	it("dispatches the nearest snap point once the drag ends, not while it's still in progress", () => {
		const onResize = vi.fn();
		const { result } = renderHook(() => useResizeHandle({ currentThickness: 56, direction: 1, onResize }));

		result.current.onPointerDown(fakePointerDown(0));
		window.dispatchEvent(new PointerEvent("pointermove", { clientX: 150 }));
		expect(onResize).not.toHaveBeenCalled();

		window.dispatchEvent(new PointerEvent("pointerup", { clientX: 150 }));
		expect(onResize).toHaveBeenCalledWith(256);
	});

	it("direction -1 inverts the delta -- dragging left grows a right-edge pillar's own handle", () => {
		const onResize = vi.fn();
		const { result } = renderHook(() => useResizeHandle({ currentThickness: 56, direction: -1, onResize }));

		result.current.onPointerDown(fakePointerDown(200));
		window.dispatchEvent(new PointerEvent("pointerup", { clientX: 50 })); // moved left by 150 -> grows by 150 under direction -1
		expect(onResize).toHaveBeenCalledWith(256);
	});

	it("a drag that ends back where it started snaps to the nearest point to the unchanged thickness, not a no-op", () => {
		const onResize = vi.fn();
		const { result } = renderHook(() => useResizeHandle({ currentThickness: 200, direction: 1, onResize }));

		result.current.onPointerDown(fakePointerDown(0));
		window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0 }));
		expect(onResize).toHaveBeenCalledWith(256);
	});

	it("removes its own window listeners once the drag ends -- a second, unrelated pointerup doesn't fire onResize again", () => {
		const onResize = vi.fn();
		const { result } = renderHook(() => useResizeHandle({ currentThickness: 56, direction: 1, onResize }));

		result.current.onPointerDown(fakePointerDown(0));
		window.dispatchEvent(new PointerEvent("pointerup", { clientX: 150 }));
		expect(onResize).toHaveBeenCalledTimes(1);

		window.dispatchEvent(new PointerEvent("pointerup", { clientX: 500 }));
		expect(onResize).toHaveBeenCalledTimes(1);
	});
});
