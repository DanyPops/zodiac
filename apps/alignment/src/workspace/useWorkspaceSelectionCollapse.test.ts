/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createPreferences } from "../platform/preferences.js";
import { useWorkspaceSelectionCollapse } from "./useWorkspaceSelectionCollapse.js";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
		removeItem: (key) => void values.delete(key),
		clear: () => values.clear(),
		key: () => null,
		get length() {
			return values.size;
		},
	};
}

describe("useWorkspaceSelectionCollapse", () => {
	it("reads its initial value from persisted preferences", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.workspace-selection-collapsed", "true");
		const { result } = renderHook(() => useWorkspaceSelectionCollapse(createPreferences(storage)));
		expect(result.current.collapsed).toBe(true);
	});

	it("toggle flips state, persists it, and returns the new value in the same call", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useWorkspaceSelectionCollapse(preferences));

		let returned: boolean | undefined;
		act(() => {
			returned = result.current.toggle();
		});

		expect(returned).toBe(true);
		expect(result.current.collapsed).toBe(true);
		expect(storage.getItem("alignment.workspace-selection-collapsed")).toBe("true");
	});

	it("expand always sets collapsed to false and persists it", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.workspace-selection-collapsed", "true");
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useWorkspaceSelectionCollapse(preferences));

		act(() => result.current.expand());

		expect(result.current.collapsed).toBe(false);
		expect(storage.getItem("alignment.workspace-selection-collapsed")).toBe("false");
	});
});
