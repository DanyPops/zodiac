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

	it("preserves a legacy Dashboard layout under an explicit migration key", () => {
		const storage = memoryStorage();
		const layout = JSON.stringify({ schemaVersion: 1, panels: [{ id: "ci" }] });
		storage.setItem("agent-deck-dashboard-layout", layout);
		createPreferences(storage);
		expect(storage.getItem("zodiac.workspace-layout.legacy-v1")).toBe(layout);
		expect(storage.getItem("agent-deck-dashboard-layout")).toBeNull();
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

	it("round-trips bounded saved Surface Templates and rejects malformed storage", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setSavedSurfaceTemplates([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([{ id: "saved-1", title: "My Terminal", templateId: "terminal" }]);

		storage.setItem("zodiac.saved-surface-templates", JSON.stringify([{ id: "", title: "x", templateId: "y" }, { id: 7 }]));
		expect(createPreferences(storage).savedSurfaceTemplates()).toEqual([]);
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

describe("workspaceGlyphs -- a per-client cosmetic preference, not domain identity", () => {
	it("starts empty for a fresh storage", () => {
		expect(createPreferences(memoryStorage()).workspaceGlyphs()).toEqual({});
	});

	it("setWorkspaceGlyph persists a glyph choice keyed by WorkspaceId, readable back", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setWorkspaceGlyph("ws-1", "rocket");
		expect(preferences.workspaceGlyphs()).toEqual({ "ws-1": "rocket" });
		expect(createPreferences(storage).workspaceGlyphs()).toEqual({ "ws-1": "rocket" });
	});

	it("multiple Workspaces' glyphs coexist, each independently updatable", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		preferences.setWorkspaceGlyph("ws-1", "rocket");
		preferences.setWorkspaceGlyph("ws-2", "bug");
		preferences.setWorkspaceGlyph("ws-1", "flag");
		expect(preferences.workspaceGlyphs()).toEqual({ "ws-1": "flag", "ws-2": "bug" });
	});

	it("ignores malformed stored JSON, falling back to empty rather than throwing", () => {
		const storage = memoryStorage();
		storage.setItem("zodiac.workspace-glyphs", "not json");
		expect(createPreferences(storage).workspaceGlyphs()).toEqual({});
	});

	it("ignores a non-object or array value, same defensive posture as every other collection here", () => {
		const storage = memoryStorage();
		storage.setItem("zodiac.workspace-glyphs", "[1,2,3]");
		expect(createPreferences(storage).workspaceGlyphs()).toEqual({});
	});
});
