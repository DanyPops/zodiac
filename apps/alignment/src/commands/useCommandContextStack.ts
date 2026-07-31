import { useState } from "react";
import type { CommandContext } from "./registry.js";
import type { CommandDialogMode } from "./CommandDialog.js";

const WORKSPACE_SELECTION: readonly CommandContext[] = ["workspace-selection", "global"];
const CANVAS: readonly CommandContext[] = ["canvas", "global"];
const SURFACE: readonly CommandContext[] = ["surface", "canvas", "global"];
const TEXT_INPUT: readonly CommandContext[] = ["text-input", "surface", "canvas", "global"];
const GLOBAL: readonly CommandContext[] = ["global"];
const DIALOG: readonly CommandContext[] = ["dialog"];

export interface CommandContextStack {
	/** The contexts the command registry should currently honor -- collapses to `dialog` whenever one is open. */
	effectiveContexts: readonly CommandContext[];
	dialogMode: CommandDialogMode;
	enterGlobal: () => void;
	enterWorkspaceSelection: () => void;
	enterCanvas: () => void;
	enterSurface: () => void;
	enterTextInput: () => void;
	openDialog: (mode: CommandDialogMode) => void;
	closeDialog: () => void;
}

/**
 * Named entry points replace the scattered `setActiveContexts([...])` array
 * literals that used to live inline across App.tsx, WorkspaceCanvas, and
 * WorkspaceSelection -- each one a duplicated, unlabeled context stack that
 * had to be read to know which UI region it meant.
 */
export function useCommandContextStack(): CommandContextStack {
	const [activeContexts, setActiveContexts] = useState<readonly CommandContext[]>(GLOBAL);
	const [dialogMode, setDialogMode] = useState<CommandDialogMode>(null);

	return {
		effectiveContexts: dialogMode ? DIALOG : activeContexts,
		dialogMode,
		enterGlobal: () => setActiveContexts(GLOBAL),
		enterWorkspaceSelection: () => setActiveContexts(WORKSPACE_SELECTION),
		enterCanvas: () => setActiveContexts(CANVAS),
		enterSurface: () => setActiveContexts(SURFACE),
		enterTextInput: () => setActiveContexts(TEXT_INPUT),
		openDialog: setDialogMode,
		closeDialog: () => setDialogMode(null),
	};
}
