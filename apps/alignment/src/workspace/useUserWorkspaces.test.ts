/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createPreferences } from "../platform/preferences.js";
import { useUserWorkspaces } from "./useUserWorkspaces.js";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
		clear: () => values.clear(),
		key: () => null,
		get length() {
			return values.size;
		},
	};
}

describe("useUserWorkspaces", () => {
	it("starts empty when nothing has been created yet", () => {
		const preferences = createPreferences(memoryStorage());
		const { result } = renderHook(() => useUserWorkspaces(preferences));
		expect(result.current.entries).toEqual([]);
	});

	it("createWorkspace adds a new entry with the resolved glyph, and persists it", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useUserWorkspaces(preferences));

		let id = "";
		act(() => {
			id = result.current.createWorkspace("Deploys", "rocket");
		});

		expect(id).not.toBe("");
		expect(result.current.entries).toHaveLength(1);
		expect(result.current.entries[0]).toMatchObject({ id, title: "Deploys" });
		expect(result.current.entries[0]?.icon).toBeDefined();
		expect(createPreferences(storage).userWorkspaces()).toEqual([{ id, title: "Deploys", glyphId: "rocket" }]);
	});

	it("createWorkspace trims whitespace and rejects a blank title, creating nothing", () => {
		const preferences = createPreferences(memoryStorage());
		const { result } = renderHook(() => useUserWorkspaces(preferences));

		let id = "created";
		act(() => {
			id = result.current.createWorkspace("   ", "rocket");
		});
		expect(id).toBe("");
		expect(result.current.entries).toEqual([]);
	});

	it("issues a distinct id per created Workspace", () => {
		const preferences = createPreferences(memoryStorage());
		const { result } = renderHook(() => useUserWorkspaces(preferences));

		// Both calls happen in the same act() -- the same tick, before any
		// re-render -- deliberately exercising the case a naive `[...saved, x]`
		// off a closed-over value would get wrong (the second call silently
		// dropping the first's entry).
		let first = "";
		let second = "";
		act(() => {
			first = result.current.createWorkspace("A", "flag");
			second = result.current.createWorkspace("B", "flag");
		});
		expect(first).not.toBe(second);
		expect(result.current.entries.map((entry) => entry.id)).toEqual([first, second]);
	});
});
