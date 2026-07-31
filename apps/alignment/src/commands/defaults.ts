import { CHAT_SURFACE_REGISTRY } from "../workspace/chat-surface-registry.js";
import { createCommandRegistry, type CommandDefinition, type KeybindingDefinition } from "./registry.js";

export interface AlignmentCommandActions {
	toggleWorkspaceSelection: () => void;
	focusWorkspaceSelection: () => void;
	focusCanvas: () => void;
	focusPreviousConversation: () => void;
	focusNextConversation: () => void;
	focusFirstConversation: () => void;
	focusLastConversation: () => void;
	showSurface: (surfaceId: string) => void;
	cycleTheme: () => void;
	sendMessage: () => void;
	openPalette: () => void;
	openShortcuts: () => void;
	closeDialog: () => void;
	openConversation: (conversationId?: string) => void;
	canSendMessage: () => boolean;
}

export const DEFAULT_BINDINGS: readonly KeybindingDefinition[] = [
	{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" },
	{ commandId: "workspace.focusSelection", keys: "Mod+1", context: "global" },
	{ commandId: "workspace.focusCanvas", keys: "Mod+2", context: "global" },
	{ commandId: "conversation.focusPrevious", keys: "ArrowUp", context: "workspace-selection" },
	{ commandId: "conversation.focusNext", keys: "ArrowDown", context: "workspace-selection" },
	{ commandId: "conversation.focusFirst", keys: "Home", context: "workspace-selection" },
	{ commandId: "conversation.focusLast", keys: "End", context: "workspace-selection" },
	...CHAT_SURFACE_REGISTRY.filter((surface) => surface.cycleKeys).map((surface) => ({ commandId: surface.showCommandId, keys: surface.cycleKeys as string, context: "global" as const })),
	{ commandId: "theme.cycle", keys: "Mod+Alt+L", context: "global" },
	{ commandId: "conversation.send", keys: "Mod+Enter", context: "text-input" },
	{ commandId: "palette.open", keys: "Mod+K", context: "global" },
	{ commandId: "shortcuts.open", keys: "Mod+/", context: "global" },
	{ commandId: "dialog.close", keys: "Escape", context: "dialog" },
	{ commandId: "conversation.open", keys: "Enter", context: "workspace-selection" },
];

export function createAlignmentCommandRegistry(actions: AlignmentCommandActions, userBindings: readonly KeybindingDefinition[] = []) {
	const commands: CommandDefinition[] = [
		define("workspace.toggleSelection", "Toggle workspace selection", "Show or hide the Workspace Selection surface.", actions.toggleWorkspaceSelection),
		define("workspace.focusSelection", "Focus workspace selection", "Move focus to the selected Workspace conversation.", actions.focusWorkspaceSelection),
		define("workspace.focusCanvas", "Focus workspace canvas", "Move focus to the active root surface on the canvas.", actions.focusCanvas),
		define("conversation.focusPrevious", "Focus previous conversation", "Move focus to the previous conversation in Workspace Selection.", actions.focusPreviousConversation),
		define("conversation.focusNext", "Focus next conversation", "Move focus to the next conversation in Workspace Selection.", actions.focusNextConversation),
		define("conversation.focusFirst", "Focus first conversation", "Move focus to the first conversation in Workspace Selection.", actions.focusFirstConversation),
		define("conversation.focusLast", "Focus last conversation", "Move focus to the last conversation in Workspace Selection.", actions.focusLastConversation),
		...CHAT_SURFACE_REGISTRY.map((surface) => define(surface.showCommandId, surface.showCommandTitle, surface.showCommandDescription, () => actions.showSurface(surface.id))),
		define("theme.cycle", "Cycle color theme", "Cycle through light, dark, and system themes.", actions.cycleTheme),
		{ ...define("conversation.send", "Send message", "Submit the current message to the Conversation.", actions.sendMessage), enabled: actions.canSendMessage },
		define("palette.open", "Open command palette", "Find and execute an Alignment command.", actions.openPalette),
		define("shortcuts.open", "Open keyboard shortcuts", "Inspect active keyboard bindings.", actions.openShortcuts),
		define("dialog.close", "Close dialog", "Close the active dialog and restore Workspace focus.", actions.closeDialog),
		define("conversation.open", "Open selected conversation", "Load the selected conversation into the Workspace.", (...args) => actions.openConversation(typeof args[0] === "string" ? args[0] : undefined)),
	];
	return createCommandRegistry({ commands, bindings: DEFAULT_BINDINGS, userBindings });
}

function define(id: string, title: string, description: string, execute: (...args: unknown[]) => void): CommandDefinition {
	return { id, title, description, execute };
}
