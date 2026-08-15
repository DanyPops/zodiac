import type { Position } from "dockview-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createZodiacCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { createHttpConversationClient } from "../conversation/client.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { createHttpPiClient } from "../pi/client.js";
import { resolveZodiacdBaseUrl } from "../platform/zodiacd-config.js";
import { usePiChatSessions } from "../pi/usePiChatSessions.js";
import { createPreferences } from "../platform/preferences.js";
import { cn } from "../platform/cn.js";
import { PAGE_BG } from "../platform/surface-style.js";
import { createExtensionHost } from "../extensions/extension-host.js";
import { useChatPlacement } from "../chat-placement-hooks.js";
import { SettingsDialog } from "../settings/SettingsDialog.js";
import { useTheme } from "../theme-hooks.js";
import { useShapeSettings } from "../shape-settings-hooks.js";
import { CanvasWell } from "../workspace/CanvasWell.js";
import { Composer } from "../conversation/ConversationSurface.js";
import { latestToolCallName } from "../conversation/projector.js";
import { createWorkspace, findWorkspaceIdForToolName } from "../workspace/model.js";
import { findSurfaceTemplate } from "../workspace/surface-templates.js";
import { SurfaceTemplatesPillar } from "../workspace/SurfaceTemplatesPillar.js";
import { TemplatesDialog } from "../workspace/TemplatesDialog.js";
import { SurfaceTemplatesGallery } from "../workspace/SurfaceTemplatesGallery.js";
import { useSurfaceTemplates } from "../workspace/useSurfaceTemplates.js";
import { useWorkspaceListNavigation } from "../workspace/useWorkspaceListNavigation.js";
import { useUserWorkspaces } from "../workspace/useUserWorkspaces.js";
import { useWorkspaceRegistry } from "../workspace/useWorkspaceRegistry.js";
import { CreateWorkspaceDialog } from "../workspace/CreateWorkspaceDialog.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { DockRulerFrame } from "../workspace/DockRulerFrame.js";
import type { DockRulerFrameMark } from "../workspace/dock-ruler.js";
import type { Rect } from "../platform/geometry.js";
import { WindowCarousel } from "../workspace/WindowCarousel.js";
import type { PendingDock } from "../workspace/WindowDockview.js";
import { DEFAULT_WORKSPACE_GLYPH_ID } from "../workspace/workspace-catalog.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";
import { createLlmWorkspaceTitleGenerator, createPiWorkspaceTitleComplete, provisionalTitleFromText } from "../workspace/workspace-title.js";

const zodiacdBaseUrl = resolveZodiacdBaseUrl();
const conversationClient = createHttpConversationClient({ baseUrl: zodiacdBaseUrl });
const piClient = createHttpPiClient({ baseUrl: zodiacdBaseUrl });

// The docking engine (dockview-react + its CSS theme) is a real ~80kB gzip
// dependency -- split into its own chunk so the core shell (Workspace
// Selection, Window Carousel, Chat, command palette) becomes interactive
// without waiting on it first.
const WindowDockview = lazy(() => import("../workspace/WindowDockview.js").then((module) => ({ default: module.WindowDockview })));

export function App(): React.JSX.Element {
	const preferences = useMemo(() => createPreferences(window.localStorage), []);
	// One host for the whole app's lifetime: extensions register once at
	// startup (no live discovery/reloading yet -- see the Native Extension
	// System task), so its contributed lists stay stable across renders.
	const extensionHost = useMemo(() => createExtensionHost(), []);
	const extensionSurfaceTemplates = useMemo(() => extensionHost.surfaceTemplates(), [extensionHost]);
	const extensionCommands = useMemo(() => extensionHost.commands(), [extensionHost]);
	const theme = useTheme();
	const shapeSettings = useShapeSettings(preferences);
	const chatPlacement = useChatPlacement(preferences);
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
	const workspace = useWorkspaceRegistry(catalog, (id, title) => createWorkspace({ id, title }), extensionHost);
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
	// Same two-layer split as renameWorkspace above: the persisted catalog
	// entry (userWorkspaces) and the live in-memory Workspace state
	// (useWorkspaceRegistry) each own their own half and must drop it together.
	function removeWorkspace(id: string): void {
		userWorkspaces.removeWorkspace(id);
		workspace.removeWorkspace(id);
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
	const [dockCanvasBox, setDockCanvasBox] = useState<Rect | undefined>(undefined);

	const latestToolName = latestToolCallName(activeConversationItems);
	const toolCallWorkspaceId = latestToolName ? findWorkspaceIdForToolName(workspace.workspaces, latestToolName) : undefined;

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

	function handlePanelClosed(instanceId: string): void {
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
					onWorkspaceRemove={removeWorkspace}
				/>

				<div className="relative flex min-w-0 flex-1 flex-col gap-2">
					<CanvasWell
						center={
							workspace.workspace && workspace.activeWindow ? (
								<WindowCarousel
									windowCount={workspace.workspace.windows.length}
									activeIndex={workspace.workspace.activeWindowIndex}
									onSelect={workspace.selectWindow}
									onScroll={workspace.scrollWindow}
									activeWindowTitle={workspace.activeWindow.title}
									onRenameActiveWindow={(title) => workspace.renameWindow(workspace.activeWindow!.id, title)}
								/>
							) : undefined
						}
					>
						{workspace.workspace && workspace.activeWindow ? (
							<section
								ref={canvasRef}
								tabIndex={-1}
								onFocus={(event) => {
									if (event.currentTarget === event.target) contexts.enterCanvas();
								}}
								aria-label="Window view"
								className="min-h-0 flex-1 overflow-hidden outline-none"
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
										chatPlacement={chatPlacement.value}
										onDockRulerHintChange={setDockRulerMark}
										dragActive={templateDragging}
									/>
								</Suspense>
							</section>
						) : (
							// No Workspace yet -- Zodiac's real starting state. A minimal
							// landing: the composer only (reused verbatim from
							// ConversationSurface.tsx, the exact same component/command wiring
							// as every other composer in the app -- "conversation.send" already
							// maps to sendMessage()'s own auto-create branch above), no Window
							// Carousel, no Chat panel.
							<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
								<p className="text-sm text-gray-500 dark:text-gray-400">Send a message to start a new Workspace.</p>
								<div className="w-full max-w-xl px-4">
									<Composer draft={draft} onDraftChange={setDraft} onComposerFocus={contexts.enterTextInput} bare />
								</div>
							</div>
						)}
					</CanvasWell>
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
				<SettingsDialog
					open={contexts.dialogMode === "appearance"}
					onClose={() => {
						contexts.closeDialog();
						contexts.enterGlobal();
					}}
					value={shapeSettings.value}
					onStrokeWidthChange={shapeSettings.setStrokeWidth}
					onCornerRadiusChange={shapeSettings.setCornerRadius}
					chatPlacement={chatPlacement.value}
					onChatPlacementChange={chatPlacement.setPlacement}
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
