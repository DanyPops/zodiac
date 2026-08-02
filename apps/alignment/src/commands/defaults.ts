import { SURFACE_TEMPLATE_REGISTRY } from "../workspace/surface-templates.js";
import { createCommandRegistry, type CommandDefinition, type KeybindingDefinition } from "./registry.js";

export interface AlignmentCommandActions {
	toggleWorkspaceSelection: () => void;
	focusWorkspaceSelection: () => void;
	focusCanvas: () => void;
	selectPreviousWorkspace: () => void;
	selectNextWorkspace: () => void;
	selectFirstWorkspace: () => void;
	selectLastWorkspace: () => void;
	selectWorkspace: (workspaceId?: string) => void;
	cycleTheme: () => void;
	sendMessage: () => void;
	openPalette: () => void;
	openShortcuts: () => void;
	closeDialog: () => void;
	openConversation: (conversationId?: string) => void;
	canSendMessage: () => boolean;
	nextWindow: () => void;
	previousWindow: () => void;
	newWindow: () => void;
	toggleChat: () => void;
	openTemplatesPicker: () => void;
	dockDefaultTemplate: (templateId?: string) => void;
	openAppearance: () => void;
}

export const DEFAULT_BINDINGS: readonly KeybindingDefinition[] = [
	{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" },
	{ commandId: "workspace.focusSelection", keys: "Mod+1", context: "global" },
	{ commandId: "workspace.focusCanvas", keys: "Mod+2", context: "global" },
	{ commandId: "workspace.selectPrevious", keys: "ArrowUp", context: "workspace-selection" },
	{ commandId: "workspace.selectNext", keys: "ArrowDown", context: "workspace-selection" },
	{ commandId: "workspace.selectFirst", keys: "Home", context: "workspace-selection" },
	{ commandId: "workspace.selectLast", keys: "End", context: "workspace-selection" },
	{ commandId: "theme.cycle", keys: "Mod+Alt+L", context: "global" },
	{ commandId: "conversation.send", keys: "Mod+Enter", context: "text-input" },
	{ commandId: "palette.open", keys: "Mod+K", context: "global" },
	{ commandId: "shortcuts.open", keys: "Mod+/", context: "global" },
	{ commandId: "dialog.close", keys: "Escape", context: "dialog" },
	{ commandId: "workspace.select", keys: "Enter", context: "workspace-selection" },
	{ commandId: "window.next", keys: "Mod+PageDown", context: "global" },
	{ commandId: "window.previous", keys: "Mod+PageUp", context: "global" },
	{ commandId: "window.new", keys: "Mod+Alt+N", context: "global" },
	{ commandId: "chat.toggle", keys: "Mod+.", context: "global" },
	{ commandId: "templates.open", keys: "Mod+Shift+K", context: "global" },
	{ commandId: "appearance.open", keys: "Mod+Shift+,", context: "global" },
];

export function createAlignmentCommandRegistry(actions: AlignmentCommandActions, userBindings: readonly KeybindingDefinition[] = [], extensionCommands: readonly CommandDefinition[] = []) {
	const commands: CommandDefinition[] = [
		define("workspace.toggleSelection", "Toggle workspace selection", "Show or hide the Workspace Selection surface.", actions.toggleWorkspaceSelection),
		define("workspace.focusSelection", "Focus workspace selection", "Move focus to the selected Workspace.", actions.focusWorkspaceSelection),
		define("workspace.focusCanvas", "Focus workspace canvas", "Move focus to the active Window's docked Surfaces.", actions.focusCanvas),
		define("workspace.selectPrevious", "Focus previous Workspace", "Move focus to the previous Workspace in Workspace Selection.", actions.selectPreviousWorkspace),
		define("workspace.selectNext", "Focus next Workspace", "Move focus to the next Workspace in Workspace Selection.", actions.selectNextWorkspace),
		define("workspace.selectFirst", "Focus first Workspace", "Move focus to the first Workspace in Workspace Selection.", actions.selectFirstWorkspace),
		define("workspace.selectLast", "Focus last Workspace", "Move focus to the last Workspace in Workspace Selection.", actions.selectLastWorkspace),
		define("theme.cycle", "Cycle color theme", "Cycle through light, dark, and system themes.", actions.cycleTheme),
		{ ...define("conversation.send", "Send message", "Submit the current message to the Conversation.", actions.sendMessage), enabled: actions.canSendMessage },
		define("palette.open", "Open command palette", "Find and execute an Alignment command.", actions.openPalette),
		define("shortcuts.open", "Open keyboard shortcuts", "Inspect active keyboard bindings.", actions.openShortcuts),
		define("dialog.close", "Close dialog", "Close the active dialog and restore Workspace focus.", actions.closeDialog),
		define("conversation.open", "Open selected conversation", "Load the selected Conversation into the floating Chat Surface.", (...args) => actions.openConversation(typeof args[0] === "string" ? args[0] : undefined)),
		define("workspace.select", "Select Workspace", "Switch the active Workspace.", (...args) => actions.selectWorkspace(typeof args[0] === "string" ? args[0] : undefined)),
		define("window.next", "Next Window", "Move to the next Window in the Window Carousel, wrapping past the last.", actions.nextWindow),
		define("window.previous", "Previous Window", "Move to the previous Window in the Window Carousel, wrapping before the first.", actions.previousWindow),
		define("window.new", "New Window", "Create a new empty Window at the end of the Window Carousel.", actions.newWindow),
		define("chat.toggle", "Toggle Chat", "Show or hide the floating Conversation Chat Surface.", actions.toggleChat),
		define("templates.open", "Browse Surface Templates", "Filter Surface Templates by keyboard and choose where to dock one.", actions.openTemplatesPicker),
		define("appearance.open", "Open Visual DNA", "Adjust the shell's Vibe (line neatness) and Corner Sharpness.", actions.openAppearance),
		...SURFACE_TEMPLATE_REGISTRY.map((template) => define(template.dockCommandId, template.dockCommandTitle, template.dockCommandDescription, () => actions.dockDefaultTemplate(template.id))),
		...extensionCommands,
	];
	return createCommandRegistry({ commands, bindings: DEFAULT_BINDINGS, userBindings });
}

function define(id: string, title: string, description: string, execute: (...args: unknown[]) => void): CommandDefinition {
	return { id, title, description, execute };
}
