import type { Position } from "dockview-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CommandDialog } from "../commands/CommandDialog.js";
import { createZodiacCommandRegistry } from "../commands/defaults.js";
import { CommandProvider } from "../commands/react.js";
import { useCommandContextStack } from "../commands/useCommandContextStack.js";
import { useKeybindingOverrides } from "../commands/useKeybindingOverrides.js";
import { useConversationWorkspace } from "../conversation/useConversationWorkspace.js";
import { usePiChatSessions } from "../pi/usePiChatSessions.js";
import { createVisualCueClientActionHandler } from "../pi/visual-cue-client-action.js";
import { useRuntimeClientBundle } from "../platform/runtime-client-bundle-context.js";
import { createPreferences } from "../platform/preferences.js";
import { cn } from "../platform/cn.js";
import { PAGE_BG } from "@zodiac/ui";
import { createExtensionHost } from "../extensions/extension-host.js";
import { useChatPlacement } from "../chat-placement-hooks.js";
import { SettingsDialog } from "../settings/SettingsDialog.js";
import { useTheme } from "../theme-hooks.js";
import { useShapeSettings } from "../shape-settings-hooks.js";
import { CanvasWell } from "../workspace/CanvasWell.js";
import { Composer } from "../conversation/ConversationSurface.js";
import { latestToolCallName } from "../conversation/projector.js";
import { CHAT_TEMPLATE_ID, createWorkspace, findWorkspaceIdForToolName, type DockedSurfaceInstance } from "../workspace/model.js";
import { pruneAcknowledgedRename, type PendingRename } from "./pending-rename.js";
import { pruneAcknowledgedItem, type Acknowledgeable } from "./pending-overlay.js";
import { findSurfaceTemplate } from "../workspace/surface-templates.js";
import { SurfaceTemplatesPillar } from "../workspace/SurfaceTemplatesPillar.js";
import { TemplatesDialog } from "../workspace/TemplatesDialog.js";
import { SurfaceTemplatesGallery } from "../workspace/SurfaceTemplatesGallery.js";
import { useSurfaceTemplates } from "../workspace/useSurfaceTemplates.js";
import { useWorkspaceListNavigation } from "../workspace/useWorkspaceListNavigation.js";
import { useWorkspaceRegistry } from "../workspace/useWorkspaceRegistry.js";
import { CreateWorkspaceDialog } from "../workspace/CreateWorkspaceDialog.js";
import { useWorkspaceSelectionCollapse } from "../workspace/useWorkspaceSelectionCollapse.js";
import { DockRulerFrame } from "../workspace/DockRulerFrame.js";
import type { DockRulerFrameMark } from "../workspace/dock-ruler.js";
import type { Rect } from "../platform/geometry.js";
import { WindowCarousel } from "../workspace/WindowCarousel.js";
import type { PendingDock } from "../workspace/WindowDockview.js";
import { DEFAULT_WORKSPACE_GLYPH_ID, resolveWorkspaceGlyph, type WorkspaceCatalogEntry } from "../workspace/workspace-catalog.js";
import { WorkspaceSelection } from "../workspace/WorkspaceSelection.js";
import { WorldShell } from "../workspace/WorldShell.js";
import type { CommandId, CommandIntent, Panel, WorkspaceViewModel, WorldViewModel } from "@zodiac/protocol";
import { commandId, integrationId, surfaceId, workspaceId } from "@zodiac/protocol";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { appletIdForLocation } from "./applet-slots.js";
import { createLlmWorkspaceTitleGenerator, createPiWorkspaceTitleComplete, provisionalTitleFromText } from "../workspace/workspace-title.js";

// The docking engine (dockview-react + its CSS theme) is a real ~80kB gzip
// dependency -- split into its own chunk so the core shell (Workspace
// Selection, Window Carousel, Chat, command palette) becomes interactive
// without waiting on it first.
const WindowDockview = lazy(() => import("../workspace/WindowDockview.js").then((module) => ({ default: module.WindowDockview })));
// Same reasoning as WindowDockview above -- see LiveDaemonPanel's own doc comment for the confirmed bundle-budget breach this avoids.
const LiveDaemonPanel = lazy(() => import("../workspace/LiveDaemonPanel.js").then((module) => ({ default: module.LiveDaemonPanel })));
// Same reasoning again -- useWorldClient's own @zodiac/world dependency (the WorldClient implementation) stayed out of the entry bundle only because LiveDaemonPanel was already lazy; using it directly here would have re-introduced exactly that regression (confirmed: check:bundle-budget failed, entryJs 168.2kB vs a 151.4kB budget, before this was made lazy too).
const LiveWorldPanels = lazy(() => import("../workspace/LiveWorldPanels.js").then((module) => ({ default: module.LiveWorldPanels })));
// Same lazy-bridge discipline as LiveWorldPanels -- NotificationsPill's real data source (useNotifications' own SSE connection) stays out of the entry bundle the same way.
const LiveNotifications = lazy(() => import("../workspace/LiveNotifications.js").then((module) => ({ default: module.LiveNotifications })));

const EMPTY_WORLD_VIEW_MODEL: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

/**
 * A fresh, collision-safe WorkspaceId. Deliberately not a sequential
 * counter seeded from any client's own locally-observed state (the
 * pre-cutover useUserWorkspaces did this against localStorage) -- once
 * more than one browser tab is a real concurrent writer against one
 * daemon, a counter-based id only ever avoided collisions under a
 * single-writer assumption that no longer holds. crypto.randomUUID()
 * makes the collision probability negligible regardless of how many
 * clients are creating Workspaces at once, at the cost of a less
 * human-typeable id -- an acceptable trade since no UI surface displays a
 * raw WorkspaceId to the user.
 */
function freshWorkspaceId(): ReturnType<typeof workspaceId> {
	return workspaceId(`workspace-${crypto.randomUUID()}`);
}

/** Same reasoning as freshWorkspaceId above -- a client-minted SurfaceId, passed explicitly in surface.dock's own optional surfaceId field so the pendingDock overlay below can correlate this exact dispatch with its eventual daemon-confirmed arrival (the join key a daemon-minted id couldn't offer synchronously). */
function freshSurfaceId(): ReturnType<typeof surfaceId> {
	return surfaceId(`surface-${crypto.randomUUID()}`);
}

/** Same reasoning again -- a client-minted CommandId (workspace.rename's own optional commandId field) so pendingRenames' pruning below can key off "the daemon confirmed my exact dispatch" rather than "the viewModel now shows the value I guessed" -- see pruneAcknowledgedRename's own doc comment for why that distinction is the real fix, not a stylistic one. */
function freshCommandId(): ReturnType<typeof commandId> {
	return commandId(`cmd-${crypto.randomUUID()}`);
}

/** True once the daemon's own live view model lists this WorkspaceId -- the confirmed half of the pending/confirmed reconciliation catalog and pendingWorkspaces' own pruning effect share. */
function isConfirmedInViewModel(viewModel: WorldViewModel, id: string): boolean {
	return viewModel.workspaces.some((entry) => entry.id === id);
}



/** One Window's real (daemon-confirmed) docked Surfaces, mapped from SurfaceViewModel's shape into DockedSurfaceInstance's -- WindowDockview's own established prop shape, unchanged by this cutover. */
function daemonDockedSurfacesForWindow(window: WorkspaceViewModel["windows"][number] | undefined): DockedSurfaceInstance[] {
	return (window?.surfaces ?? []).map((surface) => ({ id: surface.id, templateId: surface.integrationId, title: surface.title }));
}

/** True once a pending dock's own client-minted id appears among the daemon's own confirmed docked Surfaces -- the confirmed half of pendingDockedSurfaces' own optimistic-then-reconciled overlay (mirrors isConfirmedInViewModel above, one level down at the Surface rather than Workspace scope). */
function isDockConfirmed(daemonDockedSurfaces: readonly DockedSurfaceInstance[], pendingId: string): boolean {
	return daemonDockedSurfaces.some((surface) => surface.id === pendingId);
}

/** The full docked-Surface list WindowDockview renders for one Window: Chat first (a client-local concept, never daemon-confirmed -- see dockTemplate's own doc comment), then every daemon-confirmed real Surface, then anything still awaiting its own round trip. */
function dockedSurfacesForWindow(chatDockedSurface: DockedSurfaceInstance | undefined, daemonDockedSurfaces: readonly DockedSurfaceInstance[], stillPendingDockedSurfaces: readonly DockedSurfaceInstance[]): DockedSurfaceInstance[] {
	return [...(chatDockedSurface ? [chatDockedSurface] : []), ...daemonDockedSurfaces, ...stillPendingDockedSurfaces];
}

export function App(): React.JSX.Element {
	const { zodiacdBaseUrl, conversationClient, piClient } = useRuntimeClientBundle();
	// The browser-side half of list_visual_cues' own Client-initiated round
	// trip (see the "apps/web: real client-action listener" Papyrus Task) --
	// watches every real tool-call-start event any chat session observes (via
	// PiChatControllerOptions.onToolCall below) and posts this Client's own
	// real listCues() result back once it sees this exact tool named. Built
	// from the injected bundle's piClient, not a module-level singleton.
	const visualCueClientAction = useMemo(() => createVisualCueClientActionHandler((sessionId, toolCallId, result) => piClient.postClientAction(sessionId, toolCallId, result)), [piClient]);
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
	// The daemon's own live WorldViewModel is this app's real Workspace-catalog
	// authority (create/rename/remove/select all dispatch CommandIntents and
	// read back from here) -- reported by the lazy LiveWorldPanels bridge below
	// (see its own doc comment for why this isn't a direct useWorldClient()
	// call: that regressed entryJs from 151.4kB to 168.2kB when tried before).
	// Starts empty until that chunk loads and connects, the same fallback
	// policy useWorldClient itself establishes.
	const [liveWorldViewModel, setLiveWorldViewModel] = useState<WorldViewModel>(EMPTY_WORLD_VIEW_MODEL);
	// A Workspace's glyph is a genuinely per-client cosmetic preference (see
	// preferences.ts's own WORKSPACE_GLYPHS_KEY doc comment) -- the daemon's
	// WorkspaceViewModel has no glyph field at all. Read once per render, not
	// memoized against a dependency array: setWorkspaceGlyph's own writes don't
	// trigger a re-render by themselves (plain localStorage), so a stale memo
	// would show yesterday's glyph until something else re-rendered this tree.
	const workspaceGlyphs = preferences.workspaceGlyphs();
	// A just-dispatched workspace.create's own optimistic catalog entry, kept
	// only until the daemon's own round trip confirms it (liveWorldViewModel
	// actually lists the id) -- the same optimistic-then-reconciled shape
	// dockTemplate's own pendingDock already established. Without this, a
	// freshly created Workspace's id would be selected locally before the
	// catalog contains it, and useWorkspaceRegistry's own deliberate
	// unknown-id guard would throw -- confirmed live (Uncaught Error:
	// useWorkspaceRegistry: no Workspace registered for id ...) before this
	// was added.
	const [pendingWorkspaces, setPendingWorkspaces] = useState<readonly (WorkspaceCatalogEntry & Acknowledgeable)[]>([]);
	// A just-dispatched workspace.rename's own optimistic title override, kept
	// only until the daemon's own round trip confirms the same title --
	// otherwise a renamed row keeps showing its old title for the full SSE
	// round trip, a real, observed source of Playwright timing flake in
	// workspace-catalog-lifecycle.spec.ts (the create/select/remove paths
	// already had their own optimistic reflection; rename was the one gap).
	const [pendingRenames, setPendingRenames] = useState<Readonly<Record<string, PendingRename>>>({});
	// Zodiac starts with zero Workspaces -- WORKSPACE_CATALOG's fixed demo
	// entries (Bug/Metrics/Chat/PRs) are no longer merged in by default; only
	// real Workspaces the daemon's own World holds populate the catalog. The
	// first one is created automatically the moment the user sends a first
	// prompt with none active -- see sendMessage() below.
	const catalog: readonly WorkspaceCatalogEntry[] = useMemo(() => {
		const confirmed = liveWorldViewModel.workspaces.map((entry) => ({ id: entry.id, title: pendingRenames[entry.id]?.title ?? entry.title, icon: resolveWorkspaceGlyph(workspaceGlyphs[entry.id] ?? DEFAULT_WORKSPACE_GLYPH_ID) }));
		const stillPending = pendingWorkspaces.filter((pending) => !isConfirmedInViewModel(liveWorldViewModel, pending.id));
		return [...confirmed, ...stillPending];
	}, [liveWorldViewModel, workspaceGlyphs, pendingWorkspaces, pendingRenames]);
	/** Wired to LiveWorldPanels' own onCommandAcknowledged below -- fires once per acknowledged commandId, for both this client's own dispatches and, harmlessly, any other client's (each overlay's own pruning only ever matches a commandId this client itself minted). Prunes all three optimistic overlays -- not just pendingRenames -- since the same "my own dispatch was applied, regardless of what the confirmed state now shows" fix applies to pendingWorkspaces/pendingDockedSurfaces too (see pending-overlay.ts's own doc comment for the create-then-removed-before-observed race this closes). */
	function handleCommandAcknowledged(acknowledgedCommandId: CommandId): void {
		setPendingRenames((current) => pruneAcknowledgedRename(current, acknowledgedCommandId));
		setPendingWorkspaces((current) => pruneAcknowledgedItem(current, acknowledgedCommandId));
		setPendingDockedSurfaces((current) => pruneAcknowledgedItem(current, acknowledgedCommandId));
	}
	// Once the daemon's own round trip confirms a pending id, drop it from
	// state outright -- not just filtered at render time above. Leaving a
	// confirmed entry sitting in `pendingWorkspaces` forever would zombie it
	// back into `catalog` the moment that same id is later genuinely removed
	// (confirmed.some would then stop matching it) -- confirmed live: this
	// was exactly why a removed Workspace kept reappearing before this effect
	// was added.
	useEffect(() => {
		setPendingWorkspaces((current) => {
			const next = current.filter((pending) => !isConfirmedInViewModel(liveWorldViewModel, pending.id));
			return next.length === current.length ? current : next;
		});
	}, [liveWorldViewModel]);
	const workspace = useWorkspaceRegistry(catalog, (id, title) => createWorkspace({ id, title }), extensionHost);
	// Keeps useWorkspaceRegistry's own local activeWorkspaceId (which still
	// drives which Workspace's local Window/Surface mock state renders --
	// that cutover is the Window-carousel/Surface-dock sibling tasks' own job,
	// not this one) in step with the daemon's real selection, including a
	// remote client's own workspace.select landing here. Optimistic local
	// selectWorkspace calls (sendMessage's auto-create, CreateWorkspaceDialog,
	// the selectWorkspace command below) already update this immediately;
	// this effect is what reconciles a *remote* change or confirms this
	// client's own once the daemon's broadcast round-trips.
	useEffect(() => {
		const daemonActiveId = liveWorldViewModel.activeWorkspaceId;
		if (daemonActiveId && daemonActiveId !== workspace.activeWorkspaceId) workspace.selectWorkspace(daemonActiveId);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- workspace.selectWorkspace is a fresh closure every render (useWorkspaceRegistry never memoizes it); depending on it would re-run this effect every render regardless of whether the daemon's own activeWorkspaceId actually changed.
	}, [liveWorldViewModel.activeWorkspaceId]);


	// The one production LLM-naming adapter: a short-lived Pi session used
	// purely to answer the naming prompt (see workspace-title.ts). piClient
	// comes from the injected runtime bundle (useRuntimeClientBundle above),
	// not a module-level singleton -- re-derived if it ever changes.
	const titleFromPrompt = useMemo(() => createLlmWorkspaceTitleGenerator(createPiWorkspaceTitleComplete(piClient)), [piClient]);
	// Chat is Pi-first: once the user sends a live message, the live Pi
	// conversation for the *active* Workspace replaces the browsed
	// (Alef-sourced, historical) one as what's displayed -- see
	// usePiChatSessions's own doc comment for why these stay two independent
	// data sources rather than one merged one. Undefined exactly when there is
	// no active Workspace yet (the empty-state landing renders instead of
	// anything that would read this).
	const piChat = workspace.workspace ? piChatSessions.chatFor(workspace.workspace.id, { onToolCall: visualCueClientAction }) : undefined;
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
	// A ref, not state -- useWorldClient's own apply() has no stable identity
	// to depend on (LiveWorldPanels reports a fresh closure every render), so
	// a state update here would cascade into a render loop; see
	// LiveWorldPanels's own doc comment. Declared here (moved up from its own
	// original panel.resize-only call site below) so the Workspace-dispatch
	// functions below can use it too.
	const applyRef = useRef<(intent: CommandIntent) => void>(() => {});
	/** Dispatches workspace.rename to the daemon -- the sole authority for a Workspace's title once this cutover lands; no more local-registry mirror to keep in sync. Optimistically reflects the new title immediately (see pendingRenames above) rather than waiting on the daemon's own round trip. */
	function renameWorkspace(id: string, title: string): void {
		const commandIdForRename = freshCommandId();
		applyRef.current({ type: "workspace.rename", workspaceId: workspaceId(id), title, commandId: commandIdForRename });
		setPendingRenames((current) => ({ ...current, [id]: { title, commandId: commandIdForRename } }));
	}
	/** Dispatches workspace.remove to the daemon. The local useWorkspaceRegistry's own Window/Surface mock state for this id is cleaned up separately once liveWorldViewModel.workspaces no longer lists it (that reconciliation is the Window-carousel/Surface-dock sibling tasks' own job) -- calling both here would race the daemon's own authoritative removal. */
	function removeWorkspace(id: string): void {
		applyRef.current({ type: "workspace.remove", workspaceId: workspaceId(id) });
	}
	/** Creates a Workspace via daemon dispatch and optimistically selects it locally (useWorkspaceRegistry's own documented fallback already covers the transient window before liveWorldViewModel catches up -- see its own doc comment). Persists the chosen glyph locally (cosmetic only, see preferences.ts). Returns the fresh id so a caller can act on it immediately (name it from an LLM prompt, start a Chat session), matching the synchronous feel the pre-cutover local-only creation had. */
	function createWorkspaceViaDaemon(title: string, glyphId: string): string {
		const id = freshWorkspaceId();
		const commandIdForCreate = freshCommandId();
		applyRef.current({ type: "workspace.create", workspaceId: id, title, commandId: commandIdForCreate });
		preferences.setWorkspaceGlyph(id, glyphId);
		setPendingWorkspaces((current) => [...current, { id, title, icon: resolveWorkspaceGlyph(glyphId), commandId: commandIdForCreate }]);
		workspace.selectWorkspace(id);
		return id;
	}
	const surfaceTemplates = useSurfaceTemplates(preferences, extensionSurfaceTemplates);
	const [draft, setDraft] = useState("");
	const [pendingDock, setPendingDock] = useState<PendingDock | undefined>(undefined);
	// A just-dispatched surface.dock's own optimistic entry, kept only until the
	// daemon's own round trip confirms it (the freshSurfaceId this client
	// minted appears among the active Window's real surfaces) -- the same
	// pending/confirmed shape pendingWorkspaces already established for
	// Workspace creation. Chat itself is never dispatched this way (see
	// dockTemplate's own doc comment) so it never appears here.
	const [pendingDockedSurfaces, setPendingDockedSurfaces] = useState<readonly (DockedSurfaceInstance & Acknowledgeable)[]>([]);
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

	// The daemon's own WorkspaceViewModel for the active Workspace -- the real
	// read side for the Window Carousel and docked-Surface rendering now
	// (windowCount/activeIndex/title, and dockedSurfacesForActiveWindow below),
	// once a Workspace's id is confirmed there (see createWorkspaceViaDaemon /
	// the catalog reconciliation above). Undefined during the same transient
	// window pendingWorkspaces already covers -- callers fall back to the
	// local useWorkspaceRegistry model below rather than rendering nothing.
	const daemonWorkspace = workspace.workspace ? liveWorldViewModel.workspaces.find((entry) => entry.id === workspace.workspace!.id) : undefined;
	const daemonActiveWindowIndex = daemonWorkspace ? daemonWorkspace.windows.findIndex((candidate) => candidate.id === daemonWorkspace.activeWindowId) : -1;
	const windowCount = daemonWorkspace ? daemonWorkspace.windows.length : (workspace.workspace?.windows.length ?? 0);
	const activeWindowIndex = daemonWorkspace && daemonActiveWindowIndex >= 0 ? daemonActiveWindowIndex : (workspace.workspace?.activeWindowIndex ?? 0);
	const activeWindowTitle = daemonWorkspace ? (daemonWorkspace.windows[activeWindowIndex]?.title ?? "") : (workspace.activeWindow?.title ?? "");
	// The active Window's real docked Surfaces (Activity/Lector/Papyrus/
	// Terminal/...), mapped from SurfaceViewModel's shape into
	// DockedSurfaceInstance's (WindowDockview's own established prop shape,
	// unchanged by this cutover -- only its data source moves). Chat is
	// deliberately excluded here and prepended from the local model instead
	// (see dockTemplate's own doc comment) -- it was never part of the real
	// domain model's Window.surfaces and this task doesn't migrate it.
	const daemonDockedSurfaces = daemonDockedSurfacesForWindow(daemonWorkspace?.windows[activeWindowIndex]);
	const stillPendingDockedSurfaces = pendingDockedSurfaces.filter((pending) => !isDockConfirmed(daemonDockedSurfaces, pending.id));
	const chatDockedSurface = workspace.activeWindow?.dockedSurfaces.find((surface) => surface.templateId === CHAT_TEMPLATE_ID);
	const dockedSurfacesForActiveWindow = dockedSurfacesForWindow(chatDockedSurface, daemonDockedSurfaces, stillPendingDockedSurfaces);
	// Once the daemon's own round trip confirms a pending dock, drop it from
	// state outright -- same not-just-filtered-at-render-time reasoning as
	// pendingWorkspaces' own pruning effect.
	useEffect(() => {
		setPendingDockedSurfaces((current) => {
			const next = current.filter((pending) => !isDockConfirmed(daemonDockedSurfaces, pending.id));
			return next.length === current.length ? current : next;
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- daemonDockedSurfaces is a fresh array every render derived from liveWorldViewModel; depending on liveWorldViewModel itself (the real trigger for a genuine change) avoids re-running this effect every render regardless of whether the daemon's own data actually changed.
	}, [liveWorldViewModel]);

	/** `newGroupSizeRatio` -- the fraction of the reference group's current size (along whichever axis `position` implies) the newly-docked Surface should occupy, chosen via the Dock Ruler. Undefined for the plain click-to-dock/tab-insert paths, which have no drag geometry to derive a fraction from. Only reachable once a Workspace exists -- the empty-state landing renders no Surface Templates pillar to trigger this from. Dispatches surface.dock to the daemon with a client-minted SurfaceId (freshSurfaceId, mirroring freshWorkspaceId's own precedent) so pendingDock's own placement bookkeeping below has a synchronous id to key off, exactly as before -- only the authority (daemon, not the local registry) has moved. */
	function dockTemplate(templateId: string, title: string, position: Position | undefined, referenceGroupId?: string, newGroupSizeRatio?: number): void {
		if (!workspace.workspace) return;
		const id = freshSurfaceId();
		const commandIdForDock = freshCommandId();
		applyRef.current({ type: "surface.dock", workspaceId: workspaceId(workspace.workspace.id), integrationId: integrationId(templateId), title, surfaceId: id, commandId: commandIdForDock });
		setPendingDockedSurfaces((current) => [...current, { id, templateId, title, commandId: commandIdForDock }]);
		setPendingDock({ instanceId: id, position, referenceGroupId, newGroupSizeRatio });
	}

	/** Chat's own close is never a real domain-model removal (see dockTemplate's own doc comment -- Chat stays a client-local concept, out of this cutover's scope); every other docked Surface's close dispatches surface.undock to the daemon. */
	function handlePanelClosed(instanceId: string): void {
		if (chatDockedSurface?.id === instanceId) {
			workspace.undockSurface(instanceId);
			return;
		}
		if (!workspace.workspace) return;
		applyRef.current({ type: "surface.undock", workspaceId: workspaceId(workspace.workspace.id), surfaceId: surfaceId(instanceId) });
	}

	/** Dispatches window.select to the daemon, translating the Carousel's own index prop into the real WindowId at that position -- window.select's own CommandIntent shape, not the Carousel's. A no-op if the daemon Workspace/index isn't resolved yet (same transient window every other Workspace-scoped dispatch here tolerates). */
	function selectWindowViaDaemon(index: number): void {
		if (!workspace.workspace || !daemonWorkspace) return;
		const target = daemonWorkspace.windows[index];
		if (!target) return;
		applyRef.current({ type: "window.select", workspaceId: workspaceId(workspace.workspace.id), windowId: target.id });
	}

	/** Dispatches window.scroll to the daemon -- the same plain wrap-around ring as window.next/window.previous (see the CommandIntent schema's own doc comment); the Carousel's own ephemeral-Window-at-the-edge behavior isn't ported yet (see the "Port scrollWindow's ephemeral-Window creation/pruning" follow-on task). */
	function scrollWindowViaDaemon(direction: 1 | -1): void {
		if (!workspace.workspace) return;
		applyRef.current({ type: "window.scroll", workspaceId: workspaceId(workspace.workspace.id), direction });
	}

	/** Dispatches window.rename for the active Window to the daemon. */
	function renameActiveWindowViaDaemon(title: string): void {
		if (!workspace.workspace || !daemonWorkspace) return;
		const active = daemonWorkspace.windows[activeWindowIndex];
		if (!active) return;
		applyRef.current({ type: "window.rename", workspaceId: workspaceId(workspace.workspace.id), windowId: active.id, title });
	}

	// Only World-level chrome placement (which edge WorkspaceSelection/
	// SurfaceTemplatesPillar render at) is live-daemon-driven today -- the
	// underlying Workspace/Window/Surface catalog above is still userWorkspaces'
	// own local-preferences model, untouched by this. An agent (or another
	// person's tab) dispatching panel.move against a real seeded Panel here
	// relocates Web's chrome the next time panels() refreshes, the same way
	// Ctrl+G already moves the TUI's chat Panel -- see the "AppletId ->
	// component resolver" task's own doc comment for why this can't be a
	// build-time-only assumption. Starts empty (appletIdForLocation's own
	// default fallback covers the gap) until the lazy LiveWorldPanels bridge
	// below loads and connects -- see its own doc comment for why this isn't
	// just a direct useWorldClient() call here.
	const [livePanels, setLivePanels] = useState<readonly Panel[]>([]);
	// Starts empty (NotificationsPill's own empty-state default covers the gap) until the lazy
	// LiveNotifications bridge below loads and connects -- see its own doc comment.
	const [livePendingApprovals, setLivePendingApprovals] = useState<readonly VehicleApprovalRequest[]>([]);
	const notificationActionsRef = useRef<{ approve: (requestId: string) => void; deny: (requestId: string) => void }>({ approve: () => {}, deny: () => {} });
	const leftAppletId = appletIdForLocation("left", livePanels);
	const rightAppletId = appletIdForLocation("right", livePanels);
	// Drag-resize-with-snapping's own dispatch: keeps the local collapse
	// preference in sync (the pre-connection/no-daemon fallback default, per
	// the "drag-resize" task's own instruction) and, once a real left Panel
	// exists, sends the authoritative panel.resize -- a no-op dispatch-wise
	// before the daemon has seeded/been reached, matching how the existing
	// toggle button already behaves offline.
	function handleWorkspaceSelectionResize(thickness: number): void {
		const nextCollapsed = thickness <= 100;
		if (nextCollapsed !== selection.collapsed) selection.toggle();
		const leftPanel = livePanels.find((panel) => panel.location === "left");
		if (leftPanel) applyRef.current({ type: "panel.resize", panelId: leftPanel.id, thickness });
	}
	// Each renderer is a thin container closure over this render's own local
	// state/handlers (Container/Presentational split -- WorkspaceSelection and
	// SurfaceTemplatesPillar themselves stay exactly as prop-driven and tested
	// as they already are); resolved by AppletId, not hand-placed by App.tsx
	// deciding "left" or "right" directly.
	const appletRenderers: Partial<Record<string, () => React.ReactNode>> = {
		"workspace-nav": () => (
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
				onResize={handleWorkspaceSelectionResize}
			/>
		),
		"surface-templates": () => (
			<SurfaceTemplatesPillar
				entries={surfaceTemplates.entries}
				onDockDefault={(templateId, title) => dockTemplate(templateId, title, undefined)}
				onTemplateDragStart={() => setTemplateDragging(true)}
				onTemplateDragEnd={() => setTemplateDragging(false)}
			/>
		),
	};

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
			selectWorkspace(id) {
				if (typeof id !== "string") return;
				workspace.selectWorkspace(id);
				applyRef.current({ type: "workspace.select", workspaceId: workspaceId(id) });
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
				const id = createWorkspaceViaDaemon(heuristicTitle, DEFAULT_WORKSPACE_GLYPH_ID);
				piChatSessions.chatFor(id, { onToolCall: visualCueClientAction }).sendMessage(text);
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
			nextWindow() {
				if (!workspace.workspace) return;
				applyRef.current({ type: "window.next", workspaceId: workspaceId(workspace.workspace.id) });
			},
			previousWindow() {
				if (!workspace.workspace) return;
				applyRef.current({ type: "window.previous", workspaceId: workspaceId(workspace.workspace.id) });
			},
			newWindow() {
				if (!workspace.workspace) return;
				applyRef.current({ type: "window.add", workspaceId: workspaceId(workspace.workspace.id) });
			},
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
				<div className="min-w-0 flex-1">
				<Suspense fallback={null}>
					<LiveWorldPanels baseUrl={zodiacdBaseUrl} onPanels={setLivePanels} onApply={(apply) => { applyRef.current = apply; }} onWorldViewModel={setLiveWorldViewModel} onCommandAcknowledged={handleCommandAcknowledged} />
					<LiveNotifications baseUrl={zodiacdBaseUrl} onPending={setLivePendingApprovals} onActions={(actions) => { notificationActionsRef.current = actions; }} />
				</Suspense>
				<WorldShell panels={livePanels} left={leftAppletId && appletRenderers[leftAppletId]?.()} right={rightAppletId && appletRenderers[rightAppletId]?.()}>
				<div className="relative flex min-w-0 flex-1 flex-col gap-2">
					<CanvasWell
						pendingApprovals={livePendingApprovals}
						onApproveRequest={(requestId) => notificationActionsRef.current.approve(requestId)}
						onDenyRequest={(requestId) => notificationActionsRef.current.deny(requestId)}
						center={
							workspace.workspace && workspace.activeWindow ? (
								<WindowCarousel
									windowCount={windowCount}
									activeIndex={activeWindowIndex}
									onSelect={selectWindowViaDaemon}
									onScroll={scrollWindowViaDaemon}
									activeWindowTitle={activeWindowTitle}
									onRenameActiveWindow={renameActiveWindowViaDaemon}
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
										dockedSurfaces={dockedSurfacesForActiveWindow}
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
				</WorldShell>
				</div>

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
						createWorkspaceViaDaemon(title, glyphId);
						setCreatingWorkspace(false);
					}}
				/>

				{/* Additive, non-disruptive proof that the daemon's own real WorldStore (not this file's own mock Workspace/Window/Surface model above) is now reachable and live from apps/web -- see the "story 6 Web half" task's own scope-correcting finding. Does not touch the WindowDockview render path at all; collapsed by default so it never competes with the real UI; lazy-loaded so it never costs first paint (see LiveDaemonPanel's own doc comment). emitExtensionEvent wires its own live WorldViewModel diffs into the same extensionHost every mock-model extension already listens on (see useWorldExtensionEvents). */}
				<Suspense fallback={null}>
					<LiveDaemonPanel baseUrl={zodiacdBaseUrl} emitExtensionEvent={extensionHost.emit} />
				</Suspense>
			</div>
		</CommandProvider>
	);
}
