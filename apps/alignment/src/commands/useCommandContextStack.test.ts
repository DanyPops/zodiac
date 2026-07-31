/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCommandContextStack } from "./useCommandContextStack.js";

describe("useCommandContextStack", () => {
	it("starts in the global context with no dialog open", () => {
		const { result } = renderHook(() => useCommandContextStack());
		expect(result.current.effectiveContexts).toEqual(["global"]);
		expect(result.current.dialogMode).toBeNull();
	});

	it("stacks the most specific context above global for each named region", () => {
		const { result } = renderHook(() => useCommandContextStack());

		act(() => result.current.enterWorkspaceSelection());
		expect(result.current.effectiveContexts).toEqual(["workspace-selection", "global"]);

		act(() => result.current.enterCanvas());
		expect(result.current.effectiveContexts).toEqual(["canvas", "global"]);

		act(() => result.current.enterTextInput());
		expect(result.current.effectiveContexts).toEqual(["text-input", "surface", "canvas", "global"]);
	});

	it("collapses to the dialog context whenever a dialog is open, regardless of the prior region", () => {
		const { result } = renderHook(() => useCommandContextStack());

		act(() => result.current.enterCanvas());
		act(() => result.current.openDialog("palette"));

		expect(result.current.effectiveContexts).toEqual(["dialog"]);
		expect(result.current.dialogMode).toBe("palette");

		act(() => result.current.closeDialog());
		expect(result.current.effectiveContexts).toEqual(["canvas", "global"]);
	});
});
