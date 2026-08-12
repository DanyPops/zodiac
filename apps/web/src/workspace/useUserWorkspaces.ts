import { highestIdSuffix } from "@alignment/server";
import { useRef, useState } from "react";
import type { Preferences, SavedWorkspace } from "../platform/preferences.js";
import { resolveWorkspaceGlyph, type WorkspaceCatalogEntry } from "./workspace-catalog.js";

export interface UserWorkspacesHandle {
	entries: readonly WorkspaceCatalogEntry[];
	/** Creates and persists a new Workspace catalog entry; returns its fresh id (empty string if the title was blank -- nothing was created). */
	createWorkspace: (title: string, glyphId: string) => string;
	/** Renames a persisted catalog entry by id; a blank (whitespace-only) title is rejected, and an unknown id is a no-op -- same guards as model.ts's renameWorkspace/renameWindow. */
	renameWorkspace: (id: string, title: string) => void;
}

const ID_PREFIX = "user-workspace";

/**
 * Owns user-created Workspace catalog entries (name + glyph), persisted via the Preferences port -- distinct from WORKSPACE_CATALOG's fixed built-in demo entries.
 *
 * The id sequence is seeded from the highest suffix already present in
 * `preferences.userWorkspaces()` at hook-init time (via `@alignment/server`'s
 * `highestIdSuffix`, the same technique `WorldStore` uses to resume past a
 * rehydrated snapshot's own ids) rather than a module-level counter that
 * starts at 0 on every page load -- a plain counter would reissue
 * `user-workspace-1` after a reload, silently colliding with (and
 * overwriting) whatever real, already-persisted Workspace already holds
 * that id.
 */
export function useUserWorkspaces(preferences: Preferences): UserWorkspacesHandle {
	const [saved, setSaved] = useState<SavedWorkspace[]>(() => preferences.userWorkspaces());
	// A ref, not a plain local: two createWorkspace calls in the same tick
	// (before a re-render) must each see the previous call's own increment,
	// the same reasoning the functional setSaved update below already applies
	// to the persisted list itself.
	const nextSuffix = useRef<number>(highestIdSuffix(saved.map((workspace) => workspace.id), ID_PREFIX));

	return {
		entries: saved.map((workspace) => ({ id: workspace.id, title: workspace.title, icon: resolveWorkspaceGlyph(workspace.glyphId) })),
		createWorkspace(title, glyphId) {
			const trimmed = title.trim();
			if (!trimmed) return "";
			nextSuffix.current += 1;
			const entry: SavedWorkspace = { id: `${ID_PREFIX}-${nextSuffix.current}`, title: trimmed, glyphId };
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
		renameWorkspace(id, title) {
			const trimmed = title.trim();
			if (!trimmed) return;
			setSaved((current) => {
				if (!current.some((workspace) => workspace.id === id)) return current;
				const next = current.map((workspace) => (workspace.id === id ? { ...workspace, title: trimmed } : workspace));
				preferences.setUserWorkspaces(next);
				return next;
			});
		},
	};
}
