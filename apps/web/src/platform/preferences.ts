import type { CommandContext, KeybindingDefinition } from "../commands/registry.js";
import { DEFAULT_CHAT_PLACEMENT, isChatPlacement, type ChatPlacement } from "./chat-placement.js";
import { clampShapeSettings, DEFAULT_SHAPE_SETTINGS, isShapeSettings, type ShapeSettings } from "./shape-settings.js";

const WORKSPACE_SELECTION_KEY = "zodiac.workspace-selection-collapsed";
const KEYBINDINGS_KEY = "zodiac.keybindings";
const SAVED_SURFACE_TEMPLATES_KEY = "zodiac.saved-surface-templates";
const USER_WORKSPACES_KEY = "zodiac.user-workspaces";
const SHAPE_KEY = "zodiac.shape";
const CHAT_PLACEMENT_KEY = "zodiac.chat-placement";
const MAX_USER_WORKSPACES = 50;
// A real, no-longer-current localStorage namespace (agent-deck, the product's
// prior name) an existing user's browser may still hold.
const LEGACY_SIDEBAR_KEY = "agent-deck-sidebar-collapsed";
// zodiac.visual-dna: the pre-rename key, same { vibe, cornerSharpness } field
// shape migrateShapeSettings translates into the current { strokeWidth, cornerRadius }.
const LEGACY_ZODIAC_VISUAL_DNA_KEY = "zodiac.visual-dna";
const LEGACY_LAYOUT_KEY = "agent-deck-dashboard-layout";
const PRESERVED_LAYOUT_KEY = "zodiac.workspace-layout.legacy-v1";
const MAX_SAVED_SURFACE_TEMPLATES = 50;

/** A user-authored Surface Template: reuses a built-in template's docked content under a name the user chose. */
export interface SavedSurfaceTemplate {
	id: string;
	title: string;
	templateId: string;
}

/** A user-created Workspace catalog entry. `glyphId` names one of WORKSPACE_GLYPH_OPTIONS (workspace-catalog.tsx) -- a component reference itself can't round-trip through storage. */
export interface SavedWorkspace {
	id: string;
	title: string;
	glyphId: string;
}

/**
 * Driven port: durable per-user settings the application layer reads/writes
 * without knowing they live in `localStorage`. `createPreferences(storage)`
 * is the only adapter; a test supplies an in-memory `Storage` instead.
 */
export interface Preferences {
	workspaceSelectionCollapsed: () => boolean;
	setWorkspaceSelectionCollapsed: (collapsed: boolean) => void;
	keybindingOverrides: () => KeybindingDefinition[];
	setKeybindingOverrides: (bindings: readonly KeybindingDefinition[]) => void;
	savedSurfaceTemplates: () => SavedSurfaceTemplate[];
	setSavedSurfaceTemplates: (templates: readonly SavedSurfaceTemplate[]) => void;
	userWorkspaces: () => SavedWorkspace[];
	setUserWorkspaces: (workspaces: readonly SavedWorkspace[]) => void;
	shapeSettings: () => ShapeSettings;
	setShapeSettings: (value: ShapeSettings) => void;
	chatPlacement: () => ChatPlacement;
	setChatPlacement: (value: ChatPlacement) => void;
}

export function createPreferences(storage: Storage): Preferences {
	migrateLegacyLayout(storage);
	migrateShapeSettings(storage);

	function readCollapsed(): boolean {
		try {
			const current = storage.getItem(WORKSPACE_SELECTION_KEY);
			if (current === "true" || current === "false") return current === "true";
			const legacy = storage.getItem(LEGACY_SIDEBAR_KEY);
			if (legacy === "true" || legacy === "false") {
				storage.setItem(WORKSPACE_SELECTION_KEY, legacy);
				storage.removeItem(LEGACY_SIDEBAR_KEY);
				return legacy === "true";
			}
		} catch {
			return false;
		}
		return false;
	}

	return {
		workspaceSelectionCollapsed: readCollapsed,
		setWorkspaceSelectionCollapsed(collapsed) {
			try {
				storage.setItem(WORKSPACE_SELECTION_KEY, String(collapsed));
			} catch {
				// The UI state remains valid when storage is unavailable.
			}
		},
		keybindingOverrides() {
			try {
				const value: unknown = JSON.parse(storage.getItem(KEYBINDINGS_KEY) ?? "[]");
				return Array.isArray(value) ? value.slice(0, 100).filter(isKeybindingDefinition) : [];
			} catch {
				return [];
			}
		},
		setKeybindingOverrides(bindings) {
			try {
				storage.setItem(KEYBINDINGS_KEY, JSON.stringify(bindings.slice(0, 100)));
			} catch {
				// The active in-memory bindings remain usable when storage is unavailable.
			}
		},
		savedSurfaceTemplates() {
			try {
				const value: unknown = JSON.parse(storage.getItem(SAVED_SURFACE_TEMPLATES_KEY) ?? "[]");
				return Array.isArray(value) ? value.slice(0, MAX_SAVED_SURFACE_TEMPLATES).filter(isSavedSurfaceTemplate) : [];
			} catch {
				return [];
			}
		},
		setSavedSurfaceTemplates(templates) {
			try {
				storage.setItem(SAVED_SURFACE_TEMPLATES_KEY, JSON.stringify(templates.slice(0, MAX_SAVED_SURFACE_TEMPLATES)));
			} catch {
				// The active in-memory saved templates remain usable when storage is unavailable.
			}
		},
		userWorkspaces() {
			try {
				const value: unknown = JSON.parse(storage.getItem(USER_WORKSPACES_KEY) ?? "[]");
				return Array.isArray(value) ? value.slice(0, MAX_USER_WORKSPACES).filter(isSavedWorkspace) : [];
			} catch {
				return [];
			}
		},
		setUserWorkspaces(workspaces) {
			try {
				storage.setItem(USER_WORKSPACES_KEY, JSON.stringify(workspaces.slice(0, MAX_USER_WORKSPACES)));
			} catch {
				// The active in-memory user Workspaces remain usable when storage is unavailable.
			}
		},
		shapeSettings() {
			try {
				const value: unknown = JSON.parse(storage.getItem(SHAPE_KEY) ?? "null");
				return isShapeSettings(value) ? clampShapeSettings(value) : DEFAULT_SHAPE_SETTINGS;
			} catch {
				return DEFAULT_SHAPE_SETTINGS;
			}
		},
		setShapeSettings(value) {
			try {
				storage.setItem(SHAPE_KEY, JSON.stringify(clampShapeSettings(value)));
			} catch {
				// The active in-memory Shape settings remain usable when storage is unavailable.
			}
		},
		chatPlacement() {
			try {
				const value: unknown = JSON.parse(storage.getItem(CHAT_PLACEMENT_KEY) ?? "null");
				return isChatPlacement(value) ? value : DEFAULT_CHAT_PLACEMENT;
			} catch {
				return DEFAULT_CHAT_PLACEMENT;
			}
		},
		setChatPlacement(value) {
			try {
				storage.setItem(CHAT_PLACEMENT_KEY, JSON.stringify(value));
			} catch {
				// The active in-memory Chat placement remains usable when storage is unavailable.
			}
		},
	};
}

function isSavedSurfaceTemplate(value: unknown): value is SavedSurfaceTemplate {
	if (typeof value !== "object" || value === null) return false;
	const template = value as Record<string, unknown>;
	return typeof template.id === "string" && template.id.length > 0 && typeof template.title === "string" && template.title.length > 0 && typeof template.templateId === "string" && template.templateId.length > 0;
}

function isSavedWorkspace(value: unknown): value is SavedWorkspace {
	if (typeof value !== "object" || value === null) return false;
	const workspace = value as Record<string, unknown>;
	return typeof workspace.id === "string" && workspace.id.length > 0 && typeof workspace.title === "string" && workspace.title.length > 0 && typeof workspace.glyphId === "string" && workspace.glyphId.length > 0;
}

const COMMAND_CONTEXTS: readonly CommandContext[] = ["global", "workspace-selection", "canvas", "surface", "text-input", "dialog"];

function isKeybindingDefinition(value: unknown): value is KeybindingDefinition {
	if (typeof value !== "object" || value === null) return false;
	const binding = value as Record<string, unknown>;
	return (
		typeof binding.commandId === "string" &&
		typeof binding.keys === "string" &&
		binding.keys.length > 0 &&
		typeof binding.context === "string" &&
		(COMMAND_CONTEXTS as readonly string[]).includes(binding.context) &&
		(binding.source === undefined || binding.source === "user")
	);
}

/** legacyKey's { vibe, cornerSharpness } shape, translated into the current { strokeWidth, cornerRadius } one -- unrecognized JSON is dropped rather than carried over malformed. */
function transformLegacyShapeSettings(raw: string): string | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null) return null;
		const legacy = value as Record<string, unknown>;
		if (typeof legacy.vibe !== "number" || typeof legacy.cornerSharpness !== "number") return null;
		return JSON.stringify({ strokeWidth: legacy.vibe, cornerRadius: legacy.cornerSharpness });
	} catch {
		return null;
	}
}

/** Translates the legacy { vibe, cornerSharpness } field shape into the current { strokeWidth, cornerRadius } one instead of copying raw JSON verbatim -- a plain copy would leave old field names the current isShapeSettings guard doesn't recognize, silently discarding a user's saved values back to defaults. */
function migrateShapeSettings(storage: Storage): void {
	try {
		if (storage.getItem(SHAPE_KEY) !== null) return;
		const legacy = storage.getItem(LEGACY_ZODIAC_VISUAL_DNA_KEY);
		if (legacy === null) return;
		const transformed = transformLegacyShapeSettings(legacy);
		if (transformed !== null) storage.setItem(SHAPE_KEY, transformed);
		storage.removeItem(LEGACY_ZODIAC_VISUAL_DNA_KEY);
	} catch {
		// Preserve startup when storage is unavailable; no key is removed unless the copy succeeds.
	}
}

function migrateLegacyLayout(storage: Storage): void {
	try {
		if (storage.getItem(PRESERVED_LAYOUT_KEY) !== null) return;
		const legacy = storage.getItem(LEGACY_LAYOUT_KEY);
		if (legacy === null) return;
		storage.setItem(PRESERVED_LAYOUT_KEY, legacy);
		storage.removeItem(LEGACY_LAYOUT_KEY);
	} catch {
		// Preserve startup when storage is unavailable; no key is removed unless the copy succeeds.
	}
}
