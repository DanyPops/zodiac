import type { Position } from "dockview-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createZodiacCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createHttpPiClient } from "../pi/client.js";
import { usePiChatSessions } from "../pi/usePiChatSessions.js";
import { createPreferences } from "../platform/preferences.js";
import { cn } from "../platform/cn.js";
import { PAGE_BG, WELL_BG } from "../platform/surface-style.js";
import { createWindowDragTracker } from "../platform/drag-tracker.js";
import { createWindowPointerTracker } from "../platform/pointer.js";
import { createDomWispTargetMeasurer } from "../platform/wisp-target-measurer.js";
import { createExtensionHost } from "../extensions/extension-host.js";
import { useDraggablePosition } from "../workspace/useDraggablePosition.js";
import { VisualDnaDialog } from "../settings/VisualDnaDialog.js";
import { useTheme } from "../theme-hooks.js";
import { useVisualDna } from "../visual-dna-hooks.js";
import { ChatOverlay } from "../workspace/ChatOverlay.js";
import { Composer } from "../conversation/ConversationSurface.js";
import { CHAT_TEMPLATE_ID, createWorkspace, findWorkspaceIdForToolName, isChatDocked, showChat, type Workspace } from "../workspace/model.js";
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
import { DEFAULT_WORKSPACE_GLYPH_ID } from "../workspace/workspace-catalog.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";
import { createLlmWorkspaceTitleGenerator, createPiWorkspaceTitleComplete, provisionalTitleFromText } from "../workspace/workspace-title.js";

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
	// One Pi session per Workspace, not one for the whole app: switching
	// Workspaces switches which live conversation is shown, but a Workspace
	// left in the background keeps its own agent running rather than being
	// torn down -- see usePiChatSessions's own doc comment for why `chatFor`
	// is a plain function call here, not another hook.
	const piChatSessions = usePiChatSessions(piClient);
	const userWorkspaces = useUserWorkspaces(preferences);
	// Zodiac starts with zero Workspaces -- WORKSPACE_CATALOG's fixed demo
	// entries (Bug/Metrics/Chat/PRs) are no longer merged in by default; only
	// real, persisted, user-created Workspaces populate the catalog. The first
	// one is created automatically the moment the user sends a first prompt
	// with none active -- see sendMessage() below.
	const catalog = useMemo(() => userWorkspaces.entries, [userWorkspaces.entries]);
	// A restored, persisted Workspace (every reload after the first) starts
	// with Chat hidden -- useWorkspaceRegistry's own default (a plain
	// createWorkspace), matching the "hidden by default, summoned by keymap
	// or the bottom edge" design (see workspace-slice.spec.ts). The one
	// deliberate exception is a Workspace this session just auto-created from
	// sendMessage()'s own auto-create branch below: the user was already
	// looking at what reads as "the chat" (the empty-state landing's own
	// composer), so Chat must still be visible the instant a real Workspace
	// takes that landing's place -- previously it silently vanished behind
	// the same hidden-by-default rule a *returning* Workspace correctly gets,
	// landing on a blank "Pull a Surface Template..." canvas with no visible
	// trace of the message just sent. freshlyCreatedWorkspaceIds is a plain
	// ref (not state), read via `.has`, never `.delete`d here even though a
	// single id only ever needs to read as "fresh" once: useWorkspaceRegistry
	// can call this factory for the *same* id twice for one creation --
	// once as its synchronous render-time fallback for the one-tick window
	// before its own effect has run, then again from that effect, which is
	// the call whose result actually lands in its persisted `workspaces`
	// state. Deleting on the first (fallback) call left the second, the one
	// that matters, with the flag already gone -- verified live, not assumed.
	// Left in place indefinitely instead (a plain small string per
	// user-created Workspace for the App's whole lifetime) -- the same
	// unpruned-per-id-cache tradeoff usePiChatSessions' own
	// controllers/unsubscribes Maps already make.
	const freshlyCreatedWorkspaceIds = useRef<Set<string>>(new Set());
	const createUserWorkspace = useCallback((id: string, title: string): Workspace => {
		const created = createWorkspace({ id, title });
		return freshlyCreatedWorkspaceIds.current.has(id) ? showChat(created) : created;
	}, []);
	const workspace = useWorkspaceRegistry(catalog, createUserWorkspace, extensionHost);
	// The one production LLM-naming adapter: a short-lived Pi session used
	// purely to answer the naming prompt (see workspace-title.ts). Stable
	// across renders -- piClient itself is a module-level singleton.
	const titleFromPrompt = useMemo(() => createLlmWorkspaceTitleGenerator(createPiWorkspaceTitleComplete(piClient)), []);
	// Chat is Pi-first: once the user sends a live message, the live Pi
	// conversation for the *active* Workspace replaces the browsed
	// (Alef-sourced, historical) one as what's displayed -- see
	// usePiChatSessions's own doc comment for why these stay two independent
	// data sources rather than one merged one. Undefined exactly when there is
	// no active Workspace yet (the empty-state landing renders instead of
	// anything that would read this).
	const piChat = workspace.workspace ? piChatSessions.chatFor(workspace.workspace.id) : undefined;
	const activeConversationItems = piChat?.hasStarted ? piChat.items : conversationWorkspace.conversationItems;
	const activeConversationLoading = piChat?.hasStarted ? piChat.busy : conversationWorkspace.conversationLoading;
	const activeConversationError = piChat?.hasStarted ? piChat.error : conversationWorkspace.conversationError;
	const [creatingWorkspace, setCreatingWorkspace] = useState(false);
	// Both layers must rename together: userWorkspaces' persisted
	// SavedWorkspace.title (what the catalog/sidebar actually renders) and the
	// live per-Workspace Workspace.title useWorkspaceRegistry owns (read by
	// e.g. relocateChatToActiveWindow's chat-title fallback) -- letting them
	// drift would show one title in the sidebar and another wherever the live
	// Workspace's own title is read. Not routed through the command registry:
	// unlike selectWorkspace/etc., this always carries a dynamic, freshly-typed
	// string value, not a fixed keybinding-triggered arg.
	function renameWorkspace(id: string, title: string): void {
		userWorkspaces.renameWorkspace(id, title);
		workspace.renameWorkspace(id, title);
	}
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

	const chatVisibility = useChatVisibility({ visible: workspace.workspace?.chatVisible ?? false, show: workspace.showChat, hide: workspace.hideChat, pointerTracker });
	const dragTracker = useMemo(() => createWindowDragTracker(), []);
	const chatDrag = useDraggablePosition({ x: 0, y: 0 }, dragTracker);
	const latestToolName = latestToolCallName(activeConversationItems);
	const wispWindowIndex = workspace.workspace ? resolveWispWindowIndex(workspace.workspace, latestToolName) : undefined;
	const wispTarget = useWispCursorTarget(wispWindowIndex, wispTargetMeasurer);
	const chatIsGlobal = workspace.workspace ? !isChatDocked(workspace.workspace) : true;
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

	/** `newGroupSizeRatio` -- the fraction of the reference group's current size (along whichever axis `position` implies) the newly-docked Surface should occupy, chosen via the Dock Ruler. Undefined for the plain click-to-dock/tab-insert paths, which have no drag geometry to derive a fraction from. Only reachable once a Workspace exists -- the empty-state landing renders no Surface Templates pillar to trigger this from. */
	function dockTemplate(templateId: string, title: string, position: Position | undefined, referenceGroupId?: string, newGroupSizeRatio?: number): void {
		const instance = workspace.dockSurface(templateId, title);
		if (!instance) return;
		setPendingDock({ instanceId: instance.id, position, referenceGroupId, newGroupSizeRatio });
	}

	function dockChatSurface(): void {
		const instance = workspace.dockChat("Chat");
		if (!instance) return;
		setPendingDock({ instanceId: instance.id, position: undefined });
	}

	function handlePanelClosed(instanceId: string): void {
		const closed = workspace.activeWindow?.dockedSurfaces.find((surface) => surface.id === instanceId);
		if (closed?.templateId === CHAT_TEMPLATE_ID) {
			workspace.undockChatToFloating();
			return;
		}
		workspace.undockSurface(instanceId);
	}

	const registry = createZodiacCommandRegistry(
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
				if (piChat) {
					piChat.sendMessage(text);
					setDraft("");
					return;
				}
				// No active Workspace yet: auto-create one right now, immediately
				// named from a synchronous heuristic (never delays sending), select
				// it, and send in the very same handler -- usePiChatSessions.chatFor
				// mutates a plain ref-held Map directly, not React state, so it
				// doesn't need to wait for a re-render to be usable (verified
				// against usePiChatSessions.test.ts's own back-to-back chatFor(...)
				// .sendMessage(...) calls in the same tick). The LLM-generated title
				// (workspace-title.ts) replaces the heuristic one in the background
				// once it resolves.
				const heuristicTitle = provisionalTitleFromText(text) ?? "New Workspace";
				const id = userWorkspaces.createWorkspace(heuristicTitle, DEFAULT_WORKSPACE_GLYPH_ID);
				if (!id) return;
				// Recorded before selectWorkspace: createUserWorkspace (this Workspace's
				// factory, above) reads this the moment useWorkspaceRegistry first
				// materializes id, so Chat starts visible instead of hidden-by-default.
				freshlyCreatedWorkspaceIds.current.add(id);
				workspace.selectWorkspace(id);
				piChatSessions.chatFor(id).sendMessage(text);
				setDraft("");
				void titleFromPrompt(text).then((llmTitle) => {
					if (llmTitle) renameWorkspace(id, llmTitle);
				});
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
			<div className={cn("relative flex h-dvh min-h-[32rem] gap-2 overflow-hidden p-2", PAGE_BG)} data-workspace-id={workspace.workspace?.id} data-template-dragging={templateDragging}>
				<WorkspaceSelection
					collapsed={selection.collapsed}
					catalog={workspace.catalog}
					activeWorkspaceId={workspace.activeWorkspaceId}
					selectionRef={selectionRef}
					selectedButtonRef={selectedButtonRef}
					onWorkspaceFocus={() => contexts.enterWorkspaceSelection()}
					toolCallWorkspaceId={toolCallWorkspaceId}
					onCreateWorkspace={() => setCreatingWorkspace(true)}
					onWorkspaceRename={renameWorkspace}
				/>

				<div className="relative flex min-w-0 flex-1 flex-col gap-2">
					{/* Notifications/WatchPill hover above the Window itself (top corners of this column) instead of occupying their own flex columns -- `pointer-events-none` on the spanning wrapper keeps the empty space between them from stealing clicks meant for the Window Carousel underneath; each pill's own wrapper opts back in. */}
					<div className="pointer-events-none absolute inset-0 z-30">
						{/* shadow-lg, not a one-off tier: matches the app's other small floating-chrome elements (PillarTooltip, ContextMenu.Content) -- shadow-xl/2xl are reserved for full panels/modals (WorkspaceSelection's floating variant, ChatOverlay, every dialog). */}
						<div className="pointer-events-auto absolute left-2 top-2 rounded-[var(--app-corner-radius,16px)] shadow-lg">
							<NotificationsPill />
						</div>
						<div className="pointer-events-auto absolute right-2 top-2 rounded-[var(--app-corner-radius,16px)] shadow-lg">
							<WatchPill />
						</div>
					</div>
					{workspace.workspace && workspace.activeWindow ? (
						<>
							<WindowCarousel
								windowCount={workspace.workspace.windows.length}
								activeIndex={workspace.workspace.activeWindowIndex}
								onSelect={workspace.selectWindow}
								onScroll={workspace.scrollWindow}
								activeWindowTitle={workspace.activeWindow.title}
								onRenameActiveWindow={(title) => workspace.renameWindow(workspace.activeWindow!.id, title)}
							/>
							<section
								ref={canvasRef}
								tabIndex={-1}
								onFocus={(event) => {
									if (event.currentTarget === event.target) contexts.enterCanvas();
								}}
								aria-label="Window view"
								className={cn("min-h-0 flex-1 overflow-hidden rounded-[var(--app-corner-radius,16px)] outline-none", WELL_BG)}
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
						</>
					) : (
						// No Workspace yet -- Zodiac's real starting state. A minimal
						// landing: the composer only (reused verbatim from
						// ConversationSurface.tsx, the exact same component/command wiring
						// as every other composer in the app -- "conversation.send" already
						// maps to sendMessage()'s own auto-create branch above), no Window
						// Carousel, no Chat panel.
						<div className={cn("flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-[var(--app-corner-radius,16px)]", WELL_BG)}>
							<p className="text-sm text-gray-500 dark:text-gray-400">Send a message to start a new Workspace.</p>
							<div className="w-full max-w-xl px-4">
								<Composer draft={draft} onDraftChange={setDraft} onComposerFocus={contexts.enterTextInput} bare />
							</div>
						</div>
					)}
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
