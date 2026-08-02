import type { CommandContext, KeybindingDefinition } from "../commands/registry.js";
import { clampVisualDna, DEFAULT_VISUAL_DNA, isVisualDna, type VisualDna } from "./visual-dna.js";

const WORKSPACE_SELECTION_KEY = "alignment.workspace-selection-collapsed";
const KEYBINDINGS_KEY = "alignment.keybindings";
const SAVED_SURFACE_TEMPLATES_KEY = "alignment.saved-surface-templates";
const USER_WORKSPACES_KEY = "alignment.user-workspaces";
const VISUAL_DNA_KEY = "alignment.visual-dna";
const MAX_USER_WORKSPACES = 50;
const LEGACY_SIDEBAR_KEY = "agent-deck-sidebar-collapsed";
const LEGACY_LAYOUT_KEY = "agent-deck-dashboard-layout";
const PRESERVED_LAYOUT_KEY = "alignment.workspace-layout.legacy-v1";
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
	visualDna: () => VisualDna;
	setVisualDna: (value: VisualDna) => void;
}

export function createPreferences(storage: Storage): Preferences {
	migrateLegacyLayout(storage);

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
		visualDna() {
			try {
				const value: unknown = JSON.parse(storage.getItem(VISUAL_DNA_KEY) ?? "null");
				return isVisualDna(value) ? clampVisualDna(value) : DEFAULT_VISUAL_DNA;
			} catch {
				return DEFAULT_VISUAL_DNA;
			}
		},
		setVisualDna(value) {
			try {
				storage.setItem(VISUAL_DNA_KEY, JSON.stringify(clampVisualDna(value)));
			} catch {
				// The active in-memory Visual DNA remains usable when storage is unavailable.
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
