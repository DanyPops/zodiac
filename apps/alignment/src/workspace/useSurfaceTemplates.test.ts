/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createPreferences } from "../platform/preferences.js";
import { useSurfaceTemplates } from "./useSurfaceTemplates.js";

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

describe("useSurfaceTemplates", () => {
	it("starts with only the built-in catalog", () => {
		const preferences = createPreferences(memoryStorage());
		const { result } = renderHook(() => useSurfaceTemplates(preferences));
		expect(result.current.entries.every((entry) => !entry.saved)).toBe(true);
		expect(result.current.entries.some((entry) => entry.templateId === "activity")).toBe(true);
	});

	it("saveAsTemplate adds a saved entry that resolves the built-in template's icon/command and persists it", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useSurfaceTemplates(preferences));

		act(() => result.current.saveAsTemplate("My Activity View", "activity"));

		const saved = result.current.entries.find((entry) => entry.saved);
		expect(saved).toMatchObject({ title: "My Activity View", templateId: "activity", saved: true });
		expect(createPreferences(storage).savedSurfaceTemplates()).toHaveLength(1);
	});

	it("saveAsTemplate ignores a blank title or an unknown template id", () => {
		const preferences = createPreferences(memoryStorage());
		const { result } = renderHook(() => useSurfaceTemplates(preferences));

		act(() => result.current.saveAsTemplate("   ", "activity"));
		act(() => result.current.saveAsTemplate("Valid title", "does-not-exist"));

		expect(result.current.entries.some((entry) => entry.saved)).toBe(false);
	});

	it("removeSavedTemplate removes it from the pillar and from storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useSurfaceTemplates(preferences));

		act(() => result.current.saveAsTemplate("My Activity View", "activity"));
		const savedId = result.current.entries.find((entry) => entry.saved)!.id;

		act(() => result.current.removeSavedTemplate(savedId));

		expect(result.current.entries.some((entry) => entry.saved)).toBe(false);
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([]);
	});

	it("silently drops a saved template naming a since-removed built-in template", () => {
		const storage = memoryStorage();
		createPreferences(storage).setSavedSurfaceTemplates([{ id: "stale", title: "Stale", templateId: "does-not-exist" }]);
		const preferences = createPreferences(storage);

		const { result } = renderHook(() => useSurfaceTemplates(preferences));
		expect(result.current.entries.some((entry) => entry.saved)).toBe(false);
	});
});
