import { useState } from "react";
import type { Preferences } from "../platform/preferences.js";

export interface WorkspaceSelectionCollapse {
	collapsed: boolean;
	/** Flips collapsed state, persists it, and returns the new value so a caller can react to it in the same call. */
	toggle: () => boolean;
	expand: () => void;
}

export function useWorkspaceSelectionCollapse(preferences: Preferences): WorkspaceSelectionCollapse {
	const [collapsed, setCollapsed] = useState(() => preferences.workspaceSelectionCollapsed());

	function set(next: boolean): void {
		setCollapsed(next);
		preferences.setWorkspaceSelectionCollapsed(next);
	}

	return {
		collapsed,
		toggle() {
			const next = !collapsed;
			set(next);
			return next;
		},
		expand: () => set(false),
	};
}
