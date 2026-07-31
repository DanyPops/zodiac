import { useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createAlignmentCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createPreferences } from "../platform/preferences.js";
import { useThemeCycle } from "../theme-hooks.js";
import { WorkspaceCanvas } from "../workspace/WorkspaceCanvas.js";
import { CHAT_SURFACE_ID, CONVERSATION_SURFACE_ID } from "../workspace/model.js";
import { useConversationListNavigation } from "../workspace/useConversationListNavigation.js";
import { useWorkspace } from "../workspace/useWorkspace.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";

const conversationClient = createHttpConversationClient();

export function App(): React.JSX.Element {
	const preferences = useMemo(() => createPreferences(window.localStorage), []);
	const cycleTheme = useThemeCycle();
	const selection = useWorkspaceSelectionCollapse(preferences);
	const contexts = useCommandContextStack();
	const keybindings = useKeybindingOverrides(preferences);
	const conversationWorkspace = useConversationWorkspace(conversationClient);
	const workspace = useWorkspace(conversationWorkspace.selectedConversationId ?? "pending");
	const activeTab = workspace.visibleSurfaceId(CHAT_SURFACE_ID) ?? "";
	const [draft, setDraft] = useState("");

	const selectedButtonRef = useRef<HTMLButtonElement>(null);
	const selectionRef = useRef<HTMLElement>(null);
	const canvasRef = useRef<HTMLElement>(null);
	const conversationNavigation = useConversationListNavigation(selectionRef);

	function focusSelectedConversationButton(): void {
		requestAnimationFrame(() => selectedButtonRef.current?.focus());
	}

	const registry = createAlignmentCommandRegistry(
		{
			toggleWorkspaceSelection() {
				if (selection.toggle()) {
					contexts.enterSurface();
					return;
				}
				contexts.enterWorkspaceSelection();
				focusSelectedConversationButton();
			},
			focusWorkspaceSelection() {
				selection.expand();
				contexts.enterWorkspaceSelection();
				focusSelectedConversationButton();
			},
			focusCanvas() {
				canvasRef.current?.focus();
				contexts.enterCanvas();
			},
			focusPreviousConversation: conversationNavigation.focusPrevious,
			focusNextConversation: conversationNavigation.focusNext,
			focusFirstConversation: conversationNavigation.focusFirst,
			focusLastConversation: conversationNavigation.focusLast,
			showSurface: workspace.activateSurface,
			cycleTheme,
			sendMessage() {
				const text = draft.trim();
				if (!text) return;
				conversationWorkspace.appendUserMessage(text);
				setDraft("");
			},
			openPalette: () => contexts.openDialog("palette"),
			openShortcuts: () => contexts.openDialog("shortcuts"),
			closeDialog: () => contexts.closeDialog(),
			openConversation(conversationId) {
				const resolvedId = conversationWorkspace.openConversation(typeof conversationId === "string" ? conversationId : undefined);
				if (resolvedId) workspace.activateSurface(CONVERSATION_SURFACE_ID);
			},
			canSendMessage: () => draft.trim().length > 0,
		},
		keybindings.userBindings,
	);

	return (
		<CommandProvider registry={registry} activeContexts={contexts.effectiveContexts}>
			<div className="relative flex h-dvh min-h-[32rem] overflow-hidden" data-workspace-id={workspace.workspace.id}>
				<WorkspaceSelection
					collapsed={selection.collapsed}
					conversations={conversationWorkspace.conversations}
					selectedConversationId={conversationWorkspace.selectedConversationId}
					loading={conversationWorkspace.conversationsLoading}
					activeDomain={activeTab}
					selectionRef={selectionRef}
					selectedButtonRef={selectedButtonRef}
					onConversationFocus={(id) => {
						conversationWorkspace.notifyConversationFocused(id);
						contexts.enterWorkspaceSelection();
					}}
				/>
				<WorkspaceCanvas
					canvasRef={canvasRef}
					activeTab={activeTab}
					onActiveTabChange={workspace.activateSurface}
					conversationItems={conversationWorkspace.conversationItems}
					conversationLoading={conversationWorkspace.conversationLoading}
					conversationError={conversationWorkspace.conversationError}
					draft={draft}
					onDraftChange={setDraft}
					onComposerFocus={contexts.enterTextInput}
					onCanvasFocus={contexts.enterCanvas}
				/>
				<CommandDialog
					mode={contexts.dialogMode}
					onModeChange={(mode) => {
						contexts.openDialog(mode);
						if (!mode) contexts.enterGlobal();
					}}
					onRebind={(commandId, hotkey) => keybindings.rebind(commandId, hotkey, registry.commands())}
				/>
			</div>
		</CommandProvider>
	);
}
