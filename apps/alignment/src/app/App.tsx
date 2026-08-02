import type { Position } from "dockview-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createAlignmentCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createHttpPiClient } from "../pi/client.js";
import { usePiChat } from "../pi/usePiChat.js";
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
import { SurfaceTemplatesGallery } from "../workspace/SurfaceTemplatesGallery.js";
import { useChatVisibility } from "../workspace/useChatVisibility.js";
import { useSurfaceTemplates } from "../workspace/useSurfaceTemplates.js";
import { useWorkspaceListNavigation } from "../workspace/useWorkspaceListNavigation.js";
import { useUserWorkspaces } from "../workspace/useUserWorkspaces.js";
import { useWorkspaceRegistry } from "../workspace/useWorkspaceRegistry.js";
import { CreateWorkspaceDialog } from "../workspace/CreateWorkspaceDialog.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { NotificationsPill } from "../workspace/NotificationsPill.js";
import { DockRulerFrame, type DockRulerFrameBox } from "../workspace/DockRulerFrame.js";
import type { DockRulerFrameMark } from "../workspace/dock-ruler.js";
import { WatchPill } from "../workspace/WatchPill.js";
import { WindowCarousel } from "../workspace/WindowCarousel.js";
import type { PendingDock } from "../workspace/WindowDockview.js";
import { createDemoWorkspace, WORKSPACE_CATALOG } from "../workspace/workspace-catalog.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";

const conversationClient = createHttpConversationClient();
const piClient = createHttpPiClient();

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
	// Chat is Pi-first: once the user sends a live message, the live Pi
	// conversation replaces the browsed (Alef-sourced, historical) one as
	// what's displayed -- see usePiChat's own doc comment for why these stay
	// two independent hooks rather than one merged data source.
	const piChat = usePiChat(piClient);
	const activeConversationItems = piChat.hasStarted ? piChat.items : conversationWorkspace.conversationItems;
	const activeConversationLoading = piChat.hasStarted ? piChat.busy : conversationWorkspace.conversationLoading;
	const activeConversationError = piChat.hasStarted ? piChat.error : conversationWorkspace.conversationError;
	const userWorkspaces = useUserWorkspaces(preferences);
	const catalog = useMemo(() => [...WORKSPACE_CATALOG, ...userWorkspaces.entries], [userWorkspaces.entries]);
	const workspace = useWorkspaceRegistry(catalog, createDemoWorkspace, extensionHost);
	const [creatingWorkspace, setCreatingWorkspace] = useState(false);
	const surfaceTemplates = useSurfaceTemplates(preferences, extensionSurfaceTemplates);
	const [draft, setDraft] = useState("");
	const [pendingDock, setPendingDock] = useState<PendingDock | undefined>(undefined);
	// The Dock Ruler frame's own visibility (the whole drag's duration, driven
	// by the Surface Templates pillar's own dragstart/dragend -- not tied to
	// hovering a specific drop target), its live highlighted mark (from
	// WindowDockview's own onWillShowOverlay, converted to page space), and the
	// dock canvas's own measured box to anchor the frame's bars around --
	// canvasRef lives below, measured fresh whenever a drag starts since the
	// frame's position: fixed bars need real page coordinates, not a layout ref.
	const [templateDragging, setTemplateDragging] = useState(false);
	const [dockRulerMark, setDockRulerMark] = useState<DockRulerFrameMark | undefined>(undefined);
	const [dockCanvasBox, setDockCanvasBox] = useState<DockRulerFrameBox | undefined>(undefined);

	const chatVisibility = useChatVisibility({ visible: workspace.workspace.chatVisible, show: workspace.showChat, hide: workspace.hideChat, pointerTracker });
	const dragTracker = useMemo(() => createWindowDragTracker(), []);
	const chatDrag = useDraggablePosition({ x: 0, y: 0 }, dragTracker);
	const latestToolName = latestToolCallName(activeConversationItems);
	const wispWindowIndex = resolveWispWindowIndex(workspace.workspace, latestToolName);
	const wispTarget = useWispCursorTarget(wispWindowIndex, wispTargetMeasurer);
	const chatIsGlobal = !isChatDocked(workspace.workspace);
	const toolCallWorkspaceId = chatIsGlobal && latestToolName ? findWorkspaceIdForToolName(workspace.workspaces, latestToolName) : undefined;

	const selectedButtonRef = useRef<HTMLButtonElement>(null);
	const selectionRef = useRef<HTMLElement>(null);
	const canvasRef = useRef<HTMLElement>(null);
	const workspaceNavigation = useWorkspaceListNavigation(selectionRef);

	useEffect(() => {
		if (!templateDragging) {
			setDockCanvasBox(undefined);
			return;
		}
		function measure(): void {
			const rect = canvasRef.current?.getBoundingClientRect();
			setDockCanvasBox(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined);
		}
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [templateDragging]);

	function focusSelectedWorkspaceButton(): void {
		requestAnimationFrame(() => selectedButtonRef.current?.focus());
	}

	/** `newGroupSizeRatio` -- the fraction of the reference group's current size (along whichever axis `position` implies) the newly-docked Surface should occupy, chosen via the Dock Ruler. Undefined for the plain click-to-dock/tab-insert paths, which have no drag geometry to derive a fraction from. */
	function dockTemplate(templateId: string, title: string, position: Position | undefined, referenceGroupId?: string, newGroupSizeRatio?: number): void {
		const instance = workspace.dockSurface(templateId, title);
		setPendingDock({ instanceId: instance.id, position, referenceGroupId, newGroupSizeRatio });
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
				piChat.sendMessage(text);
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
			openTemplatesGallery: () => contexts.openDialog("templatesGallery"),
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
			{/* data-template-dragging: the authoritative "is a Surface Template drag active" signal, consumed by styles.css to force-hide dockview's own root-level drop-target overlay once a drag ends -- see the CSS rule's own doc comment for why dockview's own cleanup can't be trusted to do this itself. */}
			<div className="relative flex h-dvh min-h-[32rem] gap-2 overflow-hidden bg-gray-200 p-2 dark:bg-gray-950" data-workspace-id={workspace.workspace.id} data-template-dragging={templateDragging}>
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

				{/* Notifications/WatchPill sit in the gap between each side Pillar and the center column -- not spread across the column's own full width, which would strand them far from both. */}
				<div className="shrink-0 self-start">
					<NotificationsPill />
				</div>

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
								onExternalTemplateDrop={(templateId, position, referenceGroupId, newGroupSizeRatio) => {
									const template = findSurfaceTemplate(templateId, extensionSurfaceTemplates);
									if (template) dockTemplate(templateId, template.title, position, referenceGroupId, newGroupSizeRatio);
								}}
								isDark={theme.isDark}
								extensionTemplates={extensionSurfaceTemplates}
								onSaveAsTemplate={(templateId, title) => surfaceTemplates.saveAsTemplate(title, templateId)}
								conversationItems={activeConversationItems}
								conversationLoading={activeConversationLoading}
								conversationError={activeConversationError}
								draft={draft}
								onDraftChange={setDraft}
								onComposerFocus={contexts.enterTextInput}
								onUndockChat={workspace.undockChatToFloating}
								chatPinned={workspace.chatPinned}
								onTogglePinChat={() => (workspace.chatPinned ? workspace.unpinChat() : workspace.pinChat())}
								onDockRulerHintChange={setDockRulerMark}
								dragActive={templateDragging}
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
						conversationItems={activeConversationItems}
						conversationLoading={activeConversationLoading}
						conversationError={activeConversationError}
						draft={draft}
						onDraftChange={setDraft}
						onComposerFocus={contexts.enterTextInput}
						onDock={dockChatSurface}
						position={chatDrag.position}
						dragging={chatDrag.dragging}
						onDragHandlePointerDown={chatDrag.onDragHandlePointerDown}
					/>
				</div>

				<div className="shrink-0 self-start">
					<WatchPill />
				</div>

				<SurfaceTemplatesPillar
					entries={surfaceTemplates.entries}
					onDockDefault={(templateId, title) => dockTemplate(templateId, title, undefined)}
					onTemplateDragStart={() => setTemplateDragging(true)}
					onTemplateDragEnd={() => setTemplateDragging(false)}
				/>
				<DockRulerFrame visible={templateDragging} box={dockCanvasBox} mark={dockRulerMark} />

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
				<SurfaceTemplatesGallery
					open={contexts.dialogMode === "templatesGallery"}
					onClose={() => {
						contexts.closeDialog();
						contexts.enterGlobal();
					}}
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
