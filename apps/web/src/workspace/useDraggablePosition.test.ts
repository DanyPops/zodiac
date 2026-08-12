/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DragTracker } from "../platform/drag-tracker.js";
import { useDraggablePosition } from "./useDraggablePosition.js";

function fakeTracker(): { tracker: DragTracker; move: (clientX: number, clientY: number) => void; up: () => void } {
	let moveCallback: ((clientX: number, clientY: number) => void) | undefined;
	let upCallback: (() => void) | undefined;
	return {
		tracker: {
			onMove: (callback) => {
				moveCallback = callback;
				return () => {
					moveCallback = undefined;
				};
			},
			onUp: (callback) => {
				upCallback = callback;
				return () => {
					upCallback = undefined;
				};
			},
		},
		move: (clientX, clientY) => moveCallback?.(clientX, clientY),
		up: () => upCallback?.(),
	};
}

describe("useDraggablePosition", () => {
	it("starts at the given initial position, not dragging", () => {
		const { tracker } = fakeTracker();
		const { result } = renderHook(() => useDraggablePosition({ x: 10, y: 20 }, tracker));
		expect(result.current.position).toEqual({ x: 10, y: 20 });
		expect(result.current.dragging).toBe(false);
	});

	it("moving the pointer before any pointer-down on the handle does nothing", () => {
		const { tracker, move } = fakeTracker();
		const { result } = renderHook(() => useDraggablePosition({ x: 0, y: 0 }, tracker));
		act(() => move(50, 50));
		expect(result.current.position).toEqual({ x: 0, y: 0 });
	});

	it("dragging the handle then moving the pointer offsets the position by the pointer's delta", () => {
		const { tracker, move } = fakeTracker();
		const { result } = renderHook(() => useDraggablePosition({ x: 10, y: 20 }, tracker));

		act(() => result.current.onDragHandlePointerDown({ clientX: 100, clientY: 100 }));
		expect(result.current.dragging).toBe(true);

		act(() => move(130, 90));
		expect(result.current.position).toEqual({ x: 40, y: 10 });
	});

	it("releasing the pointer stops dragging and further moves no longer affect position", () => {
		const { tracker, move, up } = fakeTracker();
		const { result } = renderHook(() => useDraggablePosition({ x: 0, y: 0 }, tracker));

		act(() => result.current.onDragHandlePointerDown({ clientX: 0, clientY: 0 }));
		act(() => move(20, 20));
		act(() => up());
		expect(result.current.dragging).toBe(false);

		act(() => move(999, 999));
		expect(result.current.position).toEqual({ x: 20, y: 20 });
	});

	it("a second drag gesture starts fresh from wherever the panel currently sits", () => {
		const { tracker, move, up } = fakeTracker();
		const { result } = renderHook(() => useDraggablePosition({ x: 0, y: 0 }, tracker));

		act(() => result.current.onDragHandlePointerDown({ clientX: 0, clientY: 0 }));
		act(() => move(20, 0));
		act(() => up());

		act(() => result.current.onDragHandlePointerDown({ clientX: 500, clientY: 500 }));
		act(() => move(510, 500));
		expect(result.current.position).toEqual({ x: 30, y: 0 });
	});
});
