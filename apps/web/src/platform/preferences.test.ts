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

describe("Zodiac preferences", () => {
	it("migrates the legacy sidebar preference (agent-deck era) all the way to today's namespace", () => {
		const storage = memoryStorage();
		storage.setItem("agent-deck-sidebar-collapsed", "true");
		const preferences = createPreferences(storage);

		expect(preferences.workspaceSelectionCollapsed()).toBe(true);
		expect(storage.getItem("zodiac.workspace-selection-collapsed")).toBe("true");
		expect(storage.getItem("agent-deck-sidebar-collapsed")).toBeNull();
	});

	it("migrates an Alignment-era sidebar preference ahead of the older agent-deck one", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.workspace-selection-collapsed", "true");
		storage.setItem("agent-deck-sidebar-collapsed", "false");
		const preferences = createPreferences(storage);

		expect(preferences.workspaceSelectionCollapsed()).toBe(true);
		expect(storage.getItem("zodiac.workspace-selection-collapsed")).toBe("true");
		expect(storage.getItem("alignment.workspace-selection-collapsed")).toBeNull();
	});

	it("preserves a legacy Dashboard layout under an explicit migration key", () => {
		const storage = memoryStorage();
		const layout = JSON.stringify({ schemaVersion: 1, panels: [{ id: "ci" }] });
		storage.setItem("agent-deck-dashboard-layout", layout);
		createPreferences(storage);
		expect(storage.getItem("zodiac.workspace-layout.legacy-v1")).toBe(layout);
		expect(storage.getItem("agent-deck-dashboard-layout")).toBeNull();
	});

	it("migrates an Alignment-era preserved layout ahead of the older agent-deck one", () => {
		const storage = memoryStorage();
		const zodiacLayout = JSON.stringify({ schemaVersion: 1, panels: [{ id: "alignment-era" }] });
		storage.setItem("alignment.workspace-layout.legacy-v1", zodiacLayout);
		storage.setItem("agent-deck-dashboard-layout", JSON.stringify({ schemaVersion: 1, panels: [{ id: "agent-deck-era" }] }));
		createPreferences(storage);
		expect(storage.getItem("zodiac.workspace-layout.legacy-v1")).toBe(zodiacLayout);
		expect(storage.getItem("alignment.workspace-layout.legacy-v1")).toBeNull();
	});

	it("round-trips bounded user keybinding overrides and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setKeybindingOverrides([{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }]);
		expect(createPreferences(storage).keybindingOverrides()).toEqual([
			{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" },
		]);

		storage.setItem("zodiac.keybindings", JSON.stringify([{ commandId: 7, keys: null }]));
		expect(createPreferences(storage).keybindingOverrides()).toEqual([]);
	});

	it("migrates Alignment-era keybinding overrides once", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.keybindings", JSON.stringify([{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }]));
		const preferences = createPreferences(storage);
		expect(preferences.keybindingOverrides()).toEqual([{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }]);
		expect(storage.getItem("alignment.keybindings")).toBeNull();
	});

	it("round-trips bounded saved Surface Templates and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setSavedSurfaceTemplates([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);

		storage.setItem("zodiac.saved-surface-templates", JSON.stringify([{ id: "", title: "x", templateId: "y" }, { id: 7 }]));
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([]);
	});

	it("migrates Alignment-era saved Surface Templates once", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.saved-surface-templates", JSON.stringify([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]));
		const preferences = createPreferences(storage);
		expect(preferences.savedSurfaceTemplates()).toEqual([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);
		expect(storage.getItem("alignment.saved-surface-templates")).toBeNull();
	});

	it("round-trips bounded user-created Workspaces and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setUserWorkspaces([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]);
		expect(createPreferences(storage).userWorkspaces()).toEqual([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]);

		storage.setItem("zodiac.user-workspaces", JSON.stringify([{ id: "", title: "x", glyphId: "y" }, { id: 7 }]));
		expect(createPreferences(storage).userWorkspaces()).toEqual([]);
	});

	it("migrates Alignment-era user-created Workspaces once", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.user-workspaces", JSON.stringify([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]));
		const preferences = createPreferences(storage);
		expect(preferences.userWorkspaces()).toEqual([{ id: "ws-1", title: "Deploys", glyphId: "rocket" }]);
		expect(storage.getItem("alignment.user-workspaces")).toBeNull();
	});

	it("round-trips bounded, clamped Shape settings and falls back on malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		expect(preferences.shapeSettings()).toEqual({ strokeWidth: 100, cornerRadius: 50 });

		preferences.setShapeSettings({ strokeWidth: 150, cornerRadius: -20 });
		expect(createPreferences(storage).shapeSettings()).toEqual({ strokeWidth: 100, cornerRadius: 0 });

		storage.setItem("zodiac.shape", JSON.stringify({ strokeWidth: "oops" }));
		expect(createPreferences(storage).shapeSettings()).toEqual({ strokeWidth: 100, cornerRadius: 50 });
	});

	it("round-trips Chat placement and falls back to the default on malformed/unknown storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		expect(preferences.chatPlacement()).toBe("right");

		preferences.setChatPlacement("bottom");
		expect(createPreferences(storage).chatPlacement()).toBe("bottom");

		storage.setItem("zodiac.chat-placement", JSON.stringify("diagonal"));
		expect(createPreferences(storage).chatPlacement()).toBe("right");
	});

	it("migrates a zodiac.visual-dna-era Shape settings value once, translating its old { vibe, cornerSharpness } field names", () => {
		const storage = memoryStorage();
		storage.setItem("zodiac.visual-dna", JSON.stringify({ vibe: 30, cornerSharpness: 40 }));
		const preferences = createPreferences(storage);
		expect(preferences.shapeSettings()).toEqual({ strokeWidth: 30, cornerRadius: 40 });
		expect(storage.getItem("zodiac.visual-dna")).toBeNull();
	});

	it("migrates an Alignment-era Visual DNA once, translating its old { vibe, cornerSharpness } field names", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.visual-dna", JSON.stringify({ vibe: 20, cornerSharpness: 10 }));
		const preferences = createPreferences(storage);
		expect(preferences.shapeSettings()).toEqual({ strokeWidth: 20, cornerRadius: 10 });
		expect(storage.getItem("alignment.visual-dna")).toBeNull();
	});

	it("prefers the more recent zodiac.visual-dna key over the older alignment.visual-dna one when both exist", () => {
		const storage = memoryStorage();
		storage.setItem("alignment.visual-dna", JSON.stringify({ vibe: 1, cornerSharpness: 1 }));
		storage.setItem("zodiac.visual-dna", JSON.stringify({ vibe: 30, cornerSharpness: 40 }));
		const preferences = createPreferences(storage);
		expect(preferences.shapeSettings()).toEqual({ strokeWidth: 30, cornerRadius: 40 });
	});

	it("discards an unrecognized legacy shape value instead of carrying it over malformed", () => {
		const storage = memoryStorage();
		storage.setItem("zodiac.visual-dna", JSON.stringify({ notShape: true }));
		const preferences = createPreferences(storage);
		expect(preferences.shapeSettings()).toEqual({ strokeWidth: 100, cornerRadius: 50 });
		expect(storage.getItem("zodiac.visual-dna")).toBeNull();
	});

	it("persists only the Zodiac namespace", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setWorkspaceSelectionCollapsed(true);
		expect(storage.getItem("zodiac.workspace-selection-collapsed")).toBe("true");
	});
});
