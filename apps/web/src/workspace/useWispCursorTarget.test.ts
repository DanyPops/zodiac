/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WispTargetMeasurer } from "../platform/wisp-target-measurer.js";
import { useWispCursorTarget } from "./useWispCursorTarget.js";

function fakeMeasurer(initial: { x: number; y: number } | undefined): { measurer: WispTargetMeasurer; resize: () => void; setResult: (r: { x: number; y: number } | undefined) => void } {
	let result = initial;
	let resizeCallback: (() => void) | undefined;
	return {
		measurer: {
			measure: vi.fn(() => result),
			onResize: (callback) => {
				resizeCallback = callback;
				return () => {
					resizeCallback = undefined;
				};
			},
		},
		resize: () => resizeCallback?.(),
		setResult: (r) => {
			result = r;
		},
	};
}

describe("useWispCursorTarget", () => {
	it("is undefined with no target Window index, and never calls the measurer", () => {
		const { measurer } = fakeMeasurer({ x: 1, y: 1 });
		const { result } = renderHook(() => useWispCursorTarget(undefined, measurer));
		expect(result.current).toBeUndefined();
		expect(measurer.measure).not.toHaveBeenCalled();
	});

	it("returns whatever the measurer reports for the given Window index", () => {
		const { measurer } = fakeMeasurer({ x: 205, y: -145 });
		const { result } = renderHook(() => useWispCursorTarget(2, measurer));
		expect(measurer.measure).toHaveBeenCalledWith(2);
		expect(result.current).toEqual({ x: 205, y: -145 });
	});

	it("is undefined when the measurer can't find the anchor or the target button", () => {
		const { measurer } = fakeMeasurer(undefined);
		const { result } = renderHook(() => useWispCursorTarget(0, measurer));
		expect(result.current).toBeUndefined();
	});

	it("re-measures whenever the port's onResize callback fires", () => {
		const { measurer, resize, setResult } = fakeMeasurer({ x: 10, y: 10 });
		const { result } = renderHook(() => useWispCursorTarget(0, measurer));
		expect(result.current).toEqual({ x: 10, y: 10 });

		setResult({ x: 40, y: 40 });
		act(resize);
		expect(result.current).toEqual({ x: 40, y: 40 });
	});
});
