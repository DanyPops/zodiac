import { useState } from "react";
import type { Preferences, SavedWorkspace } from "../platform/preferences.js";
import { resolveWorkspaceGlyph, type WorkspaceCatalogEntry } from "./workspace-catalog.js";

export interface UserWorkspacesHandle {
	entries: readonly WorkspaceCatalogEntry[];
	/** Creates and persists a new Workspace catalog entry; returns its fresh id (empty string if the title was blank -- nothing was created). */
	createWorkspace: (title: string, glyphId: string) => string;
}

let userWorkspaceIdCounter = 0;

/** Owns user-created Workspace catalog entries (name + glyph), persisted via the Preferences port -- distinct from WORKSPACE_CATALOG's fixed built-in demo entries. */
export function useUserWorkspaces(preferences: Preferences): UserWorkspacesHandle {
	const [saved, setSaved] = useState<SavedWorkspace[]>(() => preferences.userWorkspaces());

	return {
		entries: saved.map((workspace) => ({ id: workspace.id, title: workspace.title, icon: resolveWorkspaceGlyph(workspace.glyphId) })),
		createWorkspace(title, glyphId) {
			const trimmed = title.trim();
			if (!trimmed) return "";
			userWorkspaceIdCounter += 1;
			const entry: SavedWorkspace = { id: `user-workspace-${userWorkspaceIdCounter}`, title: trimmed, glyphId };
			// Functional update, not `[...saved, entry]` off the closed-over value:
			// two calls in the same tick (before a re-render) would otherwise both
			// read the same stale `saved` and the second call's setSaved would
			// silently drop the first call's entry.
			setSaved((current) => {
				const next = [...current, entry];
				preferences.setUserWorkspaces(next);
				return next;
			});
			return entry.id;
		},
	};
}
