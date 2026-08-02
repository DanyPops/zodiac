import type { Position } from "dockview-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createAlignmentCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createPreferences } from "../platform/preferences.js";
import { createWindowDragTracker } from "../platform/drag-tracker.js";
import { createWindowPointerTracker } from "../platform/pointer.js";
import { createDomWispTargetMeasurer } from "../platform/wisp-target-measurer.js";
import { createExtensionHost } from "../extensions/extension-host.js";
import { useDraggablePosition } from "../workspace/useDraggablePosition.js";
import { VisualDnaDialog } from "../settings/VisualDnaDialog.js";
import { useTheme } from "../theme-hooks.js";
import { useVisualDna } from "../visual-dna-hooks.js";
import { ChatOverlay } from "../workspace/ChatOverlay.js";
import { CHAT_TEMPLATE_ID, findWorkspaceIdForToolName, isChatDocked } from "../workspace/model.js";
import { useWispCursorTarget } from "../workspace/useWispCursorTarget.js";
import { WispCursor } from "../workspace/WispCursor.js";
import { latestToolCallName, resolveWispWindowIndex } from "../workspace/wisp-cursor.js";
import { findSurfaceTemplate } from "../workspace/surface-templates.js";
import { SurfaceTemplatesPillar } from "../workspace/SurfaceTemplatesPillar.js";
import { TemplatesDialog } from "../workspace/TemplatesDialog.js";
import { useChatVisibility } from "../workspace/useChatVisibility.js";
import { useSurfaceTemplates } from "../workspace/useSurfaceTemplates.js";
import { useWorkspaceListNavigation } from "../workspace/useWorkspaceListNavigation.js";
import { useUserWorkspaces } from "../workspace/useUserWorkspaces.js";
import { useWorkspaceRegistry } from "../workspace/useWorkspaceRegistry.js";
import { CreateWorkspaceDialog } from "../workspace/CreateWorkspaceDialog.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { WindowCarousel } from "../workspace/WindowCarousel.js";
import type { PendingDock } from "../workspace/WindowDockview.js";
import { createDemoWorkspace, WORKSPACE_CATALOG } from "../workspace/workspace-catalog.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";

const conversationClient = createHttpConversationClient();

// The docking engine (dockview-react + its CSS theme) is a real ~80kB gzip
// dependency -- split into its own chunk so the core shell (Workspace
// Selection, Window Carousel, Chat, command palette) becomes interactive
// without waiting on it first.
const WindowDockview = lazy(() => import("../workspace/WindowDockview.js").then((module) => ({ default: module.WindowDockview })));

export function App(): React.JSX.Element {
	const preferences = useMemo(() => createPreferences(window.localStorage), []);
	const pointerTracker = useMemo(() => createWindowPointerTracker(), []);
	const wispTargetMeasurer = useMemo(() => createDomWispTargetMeasurer(), []);
	// One host for the whole app's lifetime: extensions register once at
	// startup (no live discovery/reloading yet -- see the Native Extension
	// System task), so its contributed lists stay stable across renders.
	const extensionHost = useMemo(() => createExtensionHost(), []);
	const extensionSurfaceTemplates = useMemo(() => extensionHost.surfaceTemplates(), [extensionHost]);
	const extensionCommands = useMemo(() => extensionHost.commands(), [extensionHost]);
	const theme = useTheme();
	const visualDna = useVisualDna(preferences);
	const selection = useWorkspaceSelectionCollapse(preferences);
	const contexts = useCommandContextStack();
	const keybindings = useKeybindingOverrides(preferences);
	const conversationWorkspace = useConversationWorkspace(conversationClient);
	const userWorkspaces = useUserWorkspaces(preferences);
	const catalog = useMemo(() => [...WORKSPACE_CATALOG, ...userWorkspaces.entries], [userWorkspaces.entries]);
	const workspace = useWorkspaceRegistry(catalog, createDemoWorkspace, extensionHost);
	const [creatingWorkspace, setCreatingWorkspace] = useState(false);
	const surfaceTemplates = useSurfaceTemplates(preferences, extensionSurfaceTemplates);
	const [draft, setDraft] = useState("");
	const [pendingDock, setPendingDock] = useState<PendingDock | undefined>(undefined);

	const chatVisibility = useChatVisibility({ visible: workspace.workspace.chatVisible, show: workspace.showChat, hide: workspace.hideChat, pointerTracker });
	const dragTracker = useMemo(() => createWindowDragTracker(), []);
	const chatDrag = useDraggablePosition({ x: 0, y: 0 }, dragTracker);
	const latestToolName = latestToolCallName(conversationWorkspace.conversationItems);
	const wispWindowIndex = resolveWispWindowIndex(workspace.workspace, latestToolName);
	const wispTarget = useWispCursorTarget(wispWindowIndex, wispTargetMeasurer);
	const chatIsGlobal = !isChatDocked(workspace.workspace);
	const toolCallWorkspaceId = chatIsGlobal && latestToolName ? findWorkspaceIdForToolName(workspace.workspaces, latestToolName) : undefined;

	const selectedButtonRef = useRef<HTMLButtonElement>(null);
	const selectionRef = useRef<HTMLElement>(null);
	const canvasRef = useRef<HTMLElement>(null);
	const workspaceNavigation = useWorkspaceListNavigation(selectionRef);

	function focusSelectedWorkspaceButton(): void {
		requestAnimationFrame(() => selectedButtonRef.current?.focus());
	}

	function dockTemplate(templateId: string, title: string, position: Position | undefined, referenceGroupId?: string): void {
		const instance = workspace.dockSurface(templateId, title);
		setPendingDock({ instanceId: instance.id, position, referenceGroupId });
	}

	function dockChatSurface(): void {
		const instance = workspace.dockChat("Chat");
		setPendingDock({ instanceId: instance.id, position: undefined });
	}

	function handlePanelClosed(instanceId: string): void {
		const closed = workspace.activeWindow.dockedSurfaces.find((surface) => surface.id === instanceId);
		if (closed?.templateId === CHAT_TEMPLATE_ID) {
			workspace.undockChatToFloating();
			return;
		}
		workspace.undockSurface(instanceId);
	}

	const registry = createAlignmentCommandRegistry(
		{
			toggleWorkspaceSelection() {
				if (selection.toggle()) {
					contexts.enterSurface();
					return;
				}
				contexts.enterWorkspaceSelection();
				focusSelectedWorkspaceButton();
			},
			focusWorkspaceSelection() {
				selection.expand();
				contexts.enterWorkspaceSelection();
				focusSelectedWorkspaceButton();
			},
			focusCanvas() {
				canvasRef.current?.focus();
				contexts.enterCanvas();
			},
			selectPreviousWorkspace: workspaceNavigation.focusPrevious,
			selectNextWorkspace: workspaceNavigation.focusNext,
			selectFirstWorkspace: workspaceNavigation.focusFirst,
			selectLastWorkspace: workspaceNavigation.focusLast,
			selectWorkspace(workspaceId) {
				if (typeof workspaceId === "string") workspace.selectWorkspace(workspaceId);
			},
			cycleTheme: theme.cycleTheme,
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
				conversationWorkspace.openConversation(typeof conversationId === "string" ? conversationId : undefined);
			},
			canSendMessage: () => draft.trim().length > 0,
			nextWindow: workspace.nextWindow,
			previousWindow: workspace.previousWindow,
			newWindow: workspace.addWindow,
			toggleChat: workspace.toggleChat,
			openTemplatesPicker: () => contexts.openDialog("templates"),
			dockDefaultTemplate(templateId) {
				if (!templateId) return;
				const template = findSurfaceTemplate(templateId, extensionSurfaceTemplates);
				if (template) dockTemplate(templateId, template.title, undefined);
			},
			openAppearance: () => contexts.openDialog("appearance"),
		},
		keybindings.userBindings,
		extensionCommands,
	);

	return (
		<CommandProvider registry={registry} activeContexts={contexts.effectiveContexts}>
			<div className="relative flex h-dvh min-h-[32rem] gap-2 overflow-hidden bg-gray-200 p-2 dark:bg-gray-950" data-workspace-id={workspace.workspace.id}>
				<WorkspaceSelection
					collapsed={selection.collapsed}
					catalog={workspace.catalog}
					activeWorkspaceId={workspace.activeWorkspaceId}
					selectionRef={selectionRef}
					selectedButtonRef={selectedButtonRef}
					onWorkspaceFocus={() => contexts.enterWorkspaceSelection()}
					toolCallWorkspaceId={toolCallWorkspaceId}
					onCreateWorkspace={() => setCreatingWorkspace(true)}
				/>

				<div className="relative flex min-w-0 flex-1 flex-col gap-2">
					<WindowCarousel
						windowCount={workspace.workspace.windows.length}
						activeIndex={workspace.workspace.activeWindowIndex}
						onSelect={workspace.selectWindow}
						onScroll={workspace.scrollWindow}
						activeWindowTitle={workspace.activeWindow.title}
						onRenameActiveWindow={(title) => workspace.renameWindow(workspace.activeWindow.id, title)}
					/>
					<section
						ref={canvasRef}
						tabIndex={-1}
						onFocus={(event) => {
							if (event.currentTarget === event.target) contexts.enterCanvas();
						}}
						aria-label="Window view"
						className="min-h-0 flex-1 overflow-hidden rounded-[var(--app-corner-radius,16px)] bg-gray-100 outline-none dark:bg-gray-900"
					>
						<Suspense fallback={<div className="grid h-full place-items-center text-sm text-gray-500 dark:text-gray-400">Loading Window…</div>}>
							<WindowDockview
								windowId={workspace.activeWindow.id}
								dockedSurfaces={workspace.activeWindow.dockedSurfaces}
								pendingDock={pendingDock}
								onPendingDockConsumed={() => setPendingDock(undefined)}
								onPanelClosed={handlePanelClosed}
								onExternalTemplateDrop={(templateId, position, referenceGroupId) => {
									const template = findSurfaceTemplate(templateId, extensionSurfaceTemplates);
									if (template) dockTemplate(templateId, template.title, position, referenceGroupId);
								}}
								isDark={theme.isDark}
								extensionTemplates={extensionSurfaceTemplates}
								onSaveAsTemplate={(templateId, title) => surfaceTemplates.saveAsTemplate(title, templateId)}
								conversationItems={conversationWorkspace.conversationItems}
								conversationLoading={conversationWorkspace.conversationLoading}
								conversationError={conversationWorkspace.conversationError}
								draft={draft}
								onDraftChange={setDraft}
								onComposerFocus={contexts.enterTextInput}
								onUndockChat={workspace.undockChatToFloating}
								chatPinned={workspace.chatPinned}
								onTogglePinChat={() => (workspace.chatPinned ? workspace.unpinChat() : workspace.pinChat())}
							/>
						</Suspense>
					</section>

					<WispCursor visible={chatIsGlobal} target={wispTarget} />

					<ChatOverlay
						visible={workspace.workspace.chatVisible}
						onPointerEnter={chatVisibility.onPointerEnter}
						onPointerLeave={chatVisibility.onPointerLeave}
						onFocusCapture={chatVisibility.onFocusCapture}
						onBlurCapture={chatVisibility.onBlurCapture}
						conversationItems={conversationWorkspace.conversationItems}
						conversationLoading={conversationWorkspace.conversationLoading}
						conversationError={conversationWorkspace.conversationError}
						draft={draft}
						onDraftChange={setDraft}
						onComposerFocus={contexts.enterTextInput}
						onDock={dockChatSurface}
						position={chatDrag.position}
						dragging={chatDrag.dragging}
						onDragHandlePointerDown={chatDrag.onDragHandlePointerDown}
					/>
				</div>

				<SurfaceTemplatesPillar entries={surfaceTemplates.entries} onDockDefault={(templateId, title) => dockTemplate(templateId, title, undefined)} />

				<CommandDialog
					mode={contexts.dialogMode}
					onModeChange={(mode) => {
						contexts.openDialog(mode);
						if (!mode) contexts.enterGlobal();
					}}
					onRebind={(commandId, hotkey) => keybindings.rebind(commandId, hotkey, registry.commands())}
				/>
				<TemplatesDialog
					open={contexts.dialogMode === "templates"}
					onClose={() => {
						contexts.closeDialog();
						contexts.enterGlobal();
					}}
					entries={surfaceTemplates.entries}
					onDock={(templateId, title, position) => dockTemplate(templateId, title, position)}
				/>
				<VisualDnaDialog
					open={contexts.dialogMode === "appearance"}
					onClose={() => {
						contexts.closeDialog();
						contexts.enterGlobal();
					}}
					value={visualDna.value}
					onVibeChange={visualDna.setVibe}
					onCornerSharpnessChange={visualDna.setCornerSharpness}
				/>
				<CreateWorkspaceDialog
					open={creatingWorkspace}
					onClose={() => setCreatingWorkspace(false)}
					onCreate={(title, glyphId) => {
						const id = userWorkspaces.createWorkspace(title, glyphId);
						if (id) workspace.selectWorkspace(id);
						setCreatingWorkspace(false);
					}}
				/>
			</div>
		</CommandProvider>
	);
}
