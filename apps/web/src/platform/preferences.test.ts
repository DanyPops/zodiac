import { describe, expect, it } from "vitest";
import { createPreferences } from "./preferences.js";

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

describe("Alignment preferences", () => {
	it("migrates the legacy sidebar preference once", () => {
		const storage = memoryStorage();
		storage.setItem("agent-deck-sidebar-collapsed", "true");
		const preferences = createPreferences(storage);

		expect(preferences.workspaceSelectionCollapsed()).toBe(true);
		expect(storage.getItem("alignment.workspace-selection-collapsed")).toBe("true");
		expect(storage.getItem("agent-deck-sidebar-collapsed")).toBeNull();
	});

	it("preserves a legacy Dashboard layout under an explicit migration key", () => {
		const storage = memoryStorage();
		const layout = JSON.stringify({ schemaVersion: 1, panels: [{ id: "ci" }] });
		storage.setItem("agent-deck-dashboard-layout", layout);
		createPreferences(storage);
		expect(storage.getItem("alignment.workspace-layout.legacy-v1")).toBe(layout);
		expect(storage.getItem("agent-deck-dashboard-layout")).toBeNull();
	});

	it("round-trips bounded user keybinding overrides and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setKeybindingOverrides([{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }]);
		expect(createPreferences(storage).keybindingOverrides()).toEqual([
			{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" },
		]);

		storage.setItem("alignment.keybindings", JSON.stringify([{ commandId: 7, keys: null }]));
		expect(createPreferences(storage).keybindingOverrides()).toEqual([]);
	});

	it("round-trips bounded saved Surface Templates and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setSavedSurfaceTemplates([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);

		storage.setItem("alignment.saved-surface-templates", JSON.stringify([{ id: "", title: "x", templateId: "y" }, { id: 7 }]));
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([]);
	});

	it("round-trips bounded user-created Workspaces and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setUserWorkspaces([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]);
		expect(createPreferences(storage).userWorkspaces()).toEqual([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]);

		storage.setItem("alignment.user-workspaces", JSON.stringify([{ id: "", title: "x", glyphId: "y" }, { id: 7 }]));
		expect(createPreferences(storage).userWorkspaces()).toEqual([]);
	});

	it("round-trips a bounded, clamped Visual DNA and falls back on malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		expect(preferences.visualDna()).toEqual({ vibe: 100, cornerSharpness: 50 });

		preferences.setVisualDna({ vibe: 150, cornerSharpness: -20 });
		expect(createPreferences(storage).visualDna()).toEqual({ vibe: 100, cornerSharpness: 0 });

		storage.setItem("alignment.visual-dna", JSON.stringify({ vibe: "oops" }));
		expect(createPreferences(storage).visualDna()).toEqual({ vibe: 100, cornerSharpness: 50 });
	});

	it("persists only the Alignment namespace", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setWorkspaceSelectionCollapsed(true);
		expect(storage.getItem("alignment.workspace-selection-collapsed")).toBe("true");
	});
});
