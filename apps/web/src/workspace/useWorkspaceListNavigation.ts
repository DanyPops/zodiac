import type { RefObject } from "react";

export interface WorkspaceListNavigation {
	focusPrevious: () => void;
	focusNext: () => void;
	focusFirst: () => void;
	focusLast: () => void;
}

type FocusTarget = "previous" | "next" | "first" | "last";

function targetIndex(target: FocusTarget, currentIndex: number, lastIndex: number): number {
	switch (target) {
		case "first":
			return 0;
		case "last":
			return lastIndex;
		case "next":
			return Math.min(lastIndex, currentIndex + 1);
		case "previous":
			return Math.max(0, currentIndex - 1);
	}
}

/** Arrow/Home/End navigation across the Workspace glyph buttons rendered inside the given Workspace Selection container. */
export function useWorkspaceListNavigation(selectionRef: RefObject<HTMLElement | null>): WorkspaceListNavigation {
	function focus(target: FocusTarget): void {
		const buttons = Array.from(selectionRef.current?.querySelectorAll<HTMLButtonElement>("[data-workspace-catalog-id]") ?? []);
		if (buttons.length === 0) return;
		const currentIndex = Math.max(0, buttons.findIndex((button) => button === button.ownerDocument.activeElement));
		buttons[targetIndex(target, currentIndex, buttons.length - 1)]?.focus();
	}

	return {
		focusPrevious: () => focus("previous"),
		focusNext: () => focus("next"),
		focusFirst: () => focus("first"),
		focusLast: () => focus("last"),
	};
}
