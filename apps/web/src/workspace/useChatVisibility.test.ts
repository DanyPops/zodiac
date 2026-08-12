/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerTracker } from "../platform/pointer.js";
import { useChatVisibility } from "./useChatVisibility.js";

function fakePointerTracker(): PointerTracker & { fireMove: (clientY: number, viewportHeight: number) => void } {
	const listeners: ((clientY: number, viewportHeight: number) => void)[] = [];
	return {
		onMove(callback) {
			listeners.push(callback);
			return () => {
				const index = listeners.indexOf(callback);
				if (index >= 0) listeners.splice(index, 1);
			};
		},
		fireMove(clientY, viewportHeight) {
			for (const listener of listeners) listener(clientY, viewportHeight);
		},
	};
}

describe("useChatVisibility", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("calls show() when the pointer reaches within the bottom edge threshold", () => {
		const pointerTracker = fakePointerTracker();
		const show = vi.fn();
		const hide = vi.fn();
		renderHook(() => useChatVisibility({ visible: false, show, hide, pointerTracker, edgeThresholdPx: 8 }));

		act(() => pointerTracker.fireMove(500, 600)); // 100px from the bottom -- not close enough
		expect(show).not.toHaveBeenCalled();

		act(() => pointerTracker.fireMove(595, 600)); // 5px from the bottom -- within the threshold
		expect(show).toHaveBeenCalledTimes(1);
	});

	it("hides after the inactivity timeout when visible and unattended", () => {
		const pointerTracker = fakePointerTracker();
		const hide = vi.fn();
		renderHook(() => useChatVisibility({ visible: true, show: vi.fn(), hide, pointerTracker, inactivityMs: 1000 }));

		act(() => vi.advanceTimersByTime(999));
		expect(hide).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(hide).toHaveBeenCalledTimes(1);
	});

	it("does not schedule a hide while hovered or focused, and resumes the countdown once both end", () => {
		const pointerTracker = fakePointerTracker();
		const hide = vi.fn();
		const { result, rerender } = renderHook(({ visible }) => useChatVisibility({ visible, show: vi.fn(), hide, pointerTracker, inactivityMs: 1000 }), {
			initialProps: { visible: true },
		});

		act(() => result.current.onPointerEnter());
		act(() => vi.advanceTimersByTime(5000));
		expect(hide).not.toHaveBeenCalled();

		act(() => result.current.onPointerLeave());
		act(() => vi.advanceTimersByTime(999));
		expect(hide).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(1));
		expect(hide).toHaveBeenCalledTimes(1);

		rerender({ visible: true }); // no-op re-render sanity check: still stable
	});

	it("keyboard focus alone also suppresses the hide timer", () => {
		const pointerTracker = fakePointerTracker();
		const hide = vi.fn();
		const { result } = renderHook(() => useChatVisibility({ visible: true, show: vi.fn(), hide, pointerTracker, inactivityMs: 1000 }));

		act(() => result.current.onFocusCapture());
		act(() => vi.advanceTimersByTime(5000));
		expect(hide).not.toHaveBeenCalled();

		act(() => result.current.onBlurCapture());
		act(() => vi.advanceTimersByTime(1000));
		expect(hide).toHaveBeenCalledTimes(1);
	});

	it("does not schedule a hide while not visible", () => {
		const pointerTracker = fakePointerTracker();
		const hide = vi.fn();
		renderHook(() => useChatVisibility({ visible: false, show: vi.fn(), hide, pointerTracker, inactivityMs: 1000 }));

		act(() => vi.advanceTimersByTime(5000));
		expect(hide).not.toHaveBeenCalled();
	});
});
