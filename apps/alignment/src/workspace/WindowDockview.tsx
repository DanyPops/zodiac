import * as ContextMenu from "@radix-ui/react-context-menu";
import { DockviewDefaultTab, DockviewReact, positionToDirection, themeAbyssSpaced, themeLightSpaced, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type Position } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Feather, PanelLeftOpen, Pin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { cn } from "../platform/cn.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import { CHAT_TEMPLATE_ID, type DockedSurfaceInstance } from "./model.js";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog.js";
import { findSurfaceTemplate, type SurfaceTemplateDefinition } from "./surface-templates.js";

// The debounced/idle-gated drop-preview policy the redesign settled on: a
// fast pass over several drop zones must not flicker a highlight on every
// one it crosses. Suppress the overlay unless the pointer's own velocity
// since the last sampled frame is at or below this threshold.
const DRAG_HINT_IDLE_VELOCITY_PX_PER_MS = 0.5;

// How long the fade-out plays before the panel is actually removed from
// dockview -- matches --animate-surface-spawn's own scale but a touch
// slower, since closing reads calmer as a slightly longer fade than the
// spawn's snappier entrance.
const CLOSE_FADE_MS = 220;

interface SurfaceTemplatePanelParams {
	readonly templateId: string;
	/** True while fading out, just before the panel is actually removed -- see requestClose. */
	readonly closing?: boolean;
}

function makeSurfaceTemplatePanel(extensionTemplates: readonly SurfaceTemplateDefinition[]) {
	return function SurfaceTemplatePanel(props: IDockviewPanelProps<SurfaceTemplatePanelParams>): React.JSX.Element {
		const template = findSurfaceTemplate(props.params.templateId, extensionTemplates);
		const content = !template ? <div className="p-4 text-sm text-danger-80">Unknown Surface Template &quot;{props.params.templateId}&quot;.</div> : <>{template.render()}</>;
		return (
			// animate-surface-spawn plays once on mount (a bubble-expand-in); the
			// opacity transition below only ever activates later, on close -- the
			// two never run at the same time in practice.
			<div className={cn("h-full animate-surface-spawn transition-opacity duration-[220ms] motion-reduce:animate-none", props.params.closing ? "opacity-0" : "opacity-100")}>{content}</div>
		);
	};
}

/**
 * The default tab for every docked Surface, adding a right-click "Save as
 * template" item -- reached here instead of the Surface Templates pillar
 * (see SurfaceTemplatesPillar's own doc comment). Only offered for a real,
 * resolvable Surface Template that isn't the Chat singleton; Chat and an
 * unknown/stale templateId fall through to the plain default tab.
 */
function makeDockedSurfaceTab(extensionTemplates: readonly SurfaceTemplateDefinition[], onRequestSaveAsTemplate: (templateId: string, defaultTitle: string) => void, onRequestClose: (instanceId: string) => void) {
	return function DockedSurfaceTab(props: IDockviewPanelHeaderProps<SurfaceTemplatePanelParams>): React.JSX.Element {
		const templateId = props.params.templateId;
		const canSave = templateId !== CHAT_TEMPLATE_ID && findSurfaceTemplate(templateId, extensionTemplates) !== undefined;
		if (!canSave) return <DockviewDefaultTab {...props} closeActionOverride={() => onRequestClose(props.api.id)} />;

		return (
			<ContextMenu.Root>
				<ContextMenu.Trigger asChild>
					<DockviewDefaultTab {...props} closeActionOverride={() => onRequestClose(props.api.id)} />
				</ContextMenu.Trigger>
				<ContextMenu.Portal>
					<ContextMenu.Content className={cn("z-50 min-w-44 rounded-md border border-gray-200 p-1 shadow-lg outline-none dark:border-gray-700", SURFACE_BG)}>
						<ContextMenu.Item
							onSelect={() => onRequestSaveAsTemplate(templateId, props.api.title ?? templateId)}
							className="cursor-pointer rounded px-2 py-1.5 text-xs text-gray-700 outline-none data-[highlighted]:bg-gray-100 dark:text-gray-200 dark:data-[highlighted]:bg-gray-800"
						>
							Save as template…
						</ContextMenu.Item>
					</ContextMenu.Content>
				</ContextMenu.Portal>
			</ContextMenu.Root>
		);
	};
}

/** Params for the docked Chat Surface -- unlike an ordinary template, it needs live conversation data and, per the redesign, awareness of its sibling docked Surfaces in the same Window. */
export interface DockedChatParams {
	readonly conversationItems: readonly ConversationItem[];
	readonly conversationLoading: boolean;
	readonly conversationError?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
	readonly siblingTitles: readonly string[];
	readonly onUndock: () => void;
	/** Unpinned (false) means Chat travels with the active Window -- see model.ts's withChatFollowing. */
	readonly pinned: boolean;
	readonly onTogglePin: () => void;
	/** True while fading out, just before the panel is actually removed -- see requestClose. */
	readonly closing: boolean;
}

// eslint-disable-next-line sonarjs/prefer-read-only-props -- see SurfaceTemplatePanel above
function DockedChatPanel(props: IDockviewPanelProps<DockedChatParams>): React.JSX.Element {
	const { conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, siblingTitles, onUndock, pinned, closing } = props.params;
	return (
		// animate-chat-follow-bounce and animate-surface-spawn both play once on
		// mount (a fresh mount happens naturally every time Chat relocates to a
		// new active Window, each Window its own DockviewReact instance) -- the
		// opacity transition only ever activates later, on close.
		<div className={cn("flex h-full min-h-0 flex-col animate-surface-spawn transition-opacity duration-[220ms] motion-reduce:animate-none", !pinned && "animate-chat-follow-bounce", closing ? "opacity-0" : "opacity-100")}>
			<div className="flex h-8 shrink-0 items-center gap-2 border-b-[length:var(--app-line-width)] border-gray-200 px-3 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300">
				<span className="font-medium">{siblingTitles.length > 0 ? `Aware of: ${siblingTitles.join(", ")}` : "Aware of: nothing else docked here"}</span>
				<button type="button" onClick={onUndock} aria-label="Undock Chat back to the floating overlay" className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800">
					<PanelLeftOpen aria-hidden="true" size={12} />
					Float
				</button>
			</div>
			<div className="min-h-0 flex-1">
				<ConversationSurface items={conversationItems} loading={conversationLoading} error={conversationError} draft={draft} onDraftChange={onDraftChange} onComposerFocus={onComposerFocus} />
			</div>
		</div>
	);
}

/** Chat's own tab: a feather (following/unpinned) or pin (pinned) toggle, hovering the icon while unpinned previews the pin -- an affordance for "click to pin". */
function makeChatTab(onRequestClose: (instanceId: string) => void) {
	return function ChatTab(props: IDockviewPanelHeaderProps<DockedChatParams>): React.JSX.Element {
		const [hovering, setHovering] = useState(false);
		const { pinned, onTogglePin } = props.params;
		const showPinGlyph = pinned || hovering;
		return (
			<div className="relative flex items-center">
				<DockviewDefaultTab {...props} closeActionOverride={() => onRequestClose(props.api.id)} />
				<button
					type="button"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={onTogglePin}
					onMouseEnter={() => setHovering(true)}
					onMouseLeave={() => setHovering(false)}
					aria-label={pinned ? "Unpin Chat from this Window" : "Pin Chat to this Window"}
					aria-pressed={pinned}
					className="absolute right-7 grid size-5 place-items-center rounded text-gray-400 hover:bg-gray-500/10 hover:text-gray-700 dark:hover:text-gray-200"
				>
					{showPinGlyph ? <Pin aria-hidden="true" size={11} /> : <Feather aria-hidden="true" size={11} />}
				</button>
			</div>
		);
	};
}

/** A domain-docked instance still awaiting placement in the docking engine -- carries the split direction (or `undefined` for the engine's own default) a keyboard or drag placement chose. */
export interface PendingDock {
	instanceId: string;
	position?: Position;
	referenceGroupId?: string;
}

interface WindowDockviewProps {
	/** Remounts the whole docking engine when the active Window changes -- each Window owns its own independent arrangement. */
	readonly windowId: string;
	readonly dockedSurfaces: readonly DockedSurfaceInstance[];
	readonly pendingDock?: PendingDock;
	readonly onPendingDockConsumed: () => void;
	/** The user closed a tab via the docking engine's own UI -- undock it from the domain model too (or float it, for Chat). */
	readonly onPanelClosed: (instanceId: string) => void;
	readonly onExternalTemplateDrop: (templateId: string, position: Position, referenceGroupId: string | undefined) => void;
	/** The active panel's docked-Surface instance id, or undefined when the Window is empty. Optional -- no current caller needs it ("save as template" is now reached per-tab via context menu, not by tracking the active panel), but the real dockview event is still wired through for whichever future caller does. */
	readonly onActivePanelChange?: (instanceId: string | undefined) => void;
	readonly isDark: boolean;
	/** Conversation data/actions, threaded through only for a docked Chat panel (see DockedChatParams). */
	readonly conversationItems: readonly ConversationItem[];
	readonly conversationLoading: boolean;
	readonly conversationError?: string;
	readonly draft: string;
	readonly onDraftChange: (value: string) => void;
	readonly onComposerFocus: () => void;
	readonly onUndockChat: () => void;
	readonly chatPinned: boolean;
	readonly onTogglePinChat: () => void;
	/** Extension-registered Surface Templates (e.g. an ExtensionHost's), resolved alongside the built-in registry when rendering a docked panel. */
	readonly extensionTemplates?: readonly SurfaceTemplateDefinition[];
	/** Saves a new Surface Template from a docked Surface's own tab context menu (see makeDockedSurfaceTab/SaveAsTemplateDialog). */
	readonly onSaveAsTemplate: (templateId: string, title: string) => void;
}

export function WindowDockview({
	windowId,
	dockedSurfaces,
	pendingDock,
	onPendingDockConsumed,
	onPanelClosed,
	onExternalTemplateDrop,
	onActivePanelChange = () => {},
	isDark,
	conversationItems,
	conversationLoading,
	conversationError,
	draft,
	onDraftChange,
	onComposerFocus,
	onUndockChat,
	chatPinned,
	onTogglePinChat,
	extensionTemplates = [],
	onSaveAsTemplate,
}: WindowDockviewProps): React.JSX.Element {
	const apiRef = useRef<DockviewReadyEvent["api"]>(undefined);
	const mountedIdsRef = useRef<Set<string>>(new Set());
	const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);
	const [saveAsTemplateRequest, setSaveAsTemplateRequest] = useState<{ templateId: string; defaultTitle: string } | undefined>(undefined);
	// Ids currently mid-fade, just before their real dockview removal --
	// requestClose below owns the whole lifecycle (mark closing, wait
	// CLOSE_FADE_MS, then the real api.close()).
	const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(new Set());

	function requestClose(instanceId: string): void {
		setClosingIds((current) => new Set(current).add(instanceId));
		setTimeout(() => {
			apiRef.current?.getPanel(instanceId)?.api.close();
			setClosingIds((current) => {
				if (!current.has(instanceId)) return current;
				const next = new Set(current);
				next.delete(instanceId);
				return next;
			});
		}, CLOSE_FADE_MS);
	}

	// eslint-disable-next-line react-hooks/exhaustive-deps -- extensionTemplates is expected to be a caller-memoized, effectively-static reference (see App.tsx); re-keying every panel component on each new array identity would be wrong here, not a missing dependency. requestClose is a stable closure over refs/setState, not reactive state.
	const panelComponents = useMemo(() => ({ surfaceTemplate: makeSurfaceTemplatePanel(extensionTemplates), chatSurface: DockedChatPanel }), []);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- same rationale as panelComponents above.
	const defaultTabComponent = useMemo(() => makeDockedSurfaceTab(extensionTemplates, (templateId, defaultTitle) => setSaveAsTemplateRequest({ templateId, defaultTitle }), requestClose), []);
	const chatTabComponent = useMemo(() => makeChatTab(requestClose), []);
	// eslint-disable-next-line react-hooks/exhaustive-deps -- same rationale as panelComponents above.
	const tabComponents = useMemo(() => ({ chatSurface: chatTabComponent }), []);

	function chatParams(instance: DockedSurfaceInstance): DockedChatParams {
		return {
			conversationItems,
			conversationLoading,
			conversationError,
			draft,
			onDraftChange,
			onComposerFocus,
			siblingTitles: dockedSurfaces.filter((surface) => surface.id !== instance.id).map((surface) => surface.title),
			onUndock: onUndockChat,
			pinned: chatPinned,
			onTogglePin: onTogglePinChat,
			closing: closingIds.has(instance.id),
		};
	}

	function surfaceTemplateParams(instance: DockedSurfaceInstance): SurfaceTemplatePanelParams {
		return { templateId: instance.templateId, closing: closingIds.has(instance.id) };
	}

	function mountPanel(instance: DockedSurfaceInstance, position?: Position, referenceGroupId?: string): void {
		const api = apiRef.current;
		if (!api) return;
		const isChat = instance.templateId === CHAT_TEMPLATE_ID;
		api.addPanel({
			id: instance.id,
			component: isChat ? "chatSurface" : "surfaceTemplate",
			title: instance.title,
			params: isChat ? chatParams(instance) : surfaceTemplateParams(instance),
			position: position ? { direction: positionToDirection(position), referenceGroup: referenceGroupId } : undefined,
		});
		mountedIdsRef.current.add(instance.id);
	}

	function onReady(event: DockviewReadyEvent): void {
		apiRef.current = event.api;
		mountedIdsRef.current = new Set();
		for (const instance of dockedSurfaces) mountPanel(instance);

		event.api.onDidRemovePanel((panel) => {
			mountedIdsRef.current.delete(panel.id);
			onPanelClosed(panel.id);
		});

		event.api.onDidActivePanelChange((change) => onActivePanelChange(change.panel?.id));

		// dockview rejects an external (non-dockview-panel) drag's drop-target
		// overlay by default -- a consumer must explicitly accept it. Only
		// accept drags actually carrying our own template MIME type, not any
		// arbitrary external drag (an image, a link) a user might drop in.
		event.api.onUnhandledDragOver((dndEvent) => {
			const dataTransfer = dndEvent.nativeEvent instanceof DragEvent ? dndEvent.nativeEvent.dataTransfer : null;
			if (dataTransfer?.types.includes(TEMPLATE_DRAG_MIME_TYPE)) dndEvent.accept();
		});

		// Debounce/idle-gate the split/tab preview: suppress a frame's overlay
		// unless the pointer has been moving slowly (or is idle) since the
		// previous sampled frame, so a fast pass over several drop zones
		// doesn't flicker a highlight on every one it crosses.
		event.api.onWillShowOverlay((overlayEvent) => {
			const point = overlayEvent.nativeEvent instanceof DragEvent || overlayEvent.nativeEvent instanceof PointerEvent ? { x: overlayEvent.nativeEvent.clientX, y: overlayEvent.nativeEvent.clientY, t: Date.now() } : null;
			const last = lastMoveRef.current;
			if (point) lastMoveRef.current = point;
			// No native point to measure, or no prior sample yet (the first
			// dragover of a drag): suppress rather than allow. The "Spaced" theme's
			// overlay anchor persists across frames once shown, so an unsuppressed
			// first frame stays visible through the rest of a fast pass even if
			// every later frame is correctly suppressed. Policy: wait for confirmed
			// low velocity before showing, not "show until proven fast".
			if (!point || !last) {
				overlayEvent.preventDefault();
				return;
			}
			const elapsedMs = Math.max(1, point.t - last.t);
			const velocity = Math.hypot(point.x - last.x, point.y - last.y) / elapsedMs;
			if (velocity > DRAG_HINT_IDLE_VELOCITY_PX_PER_MS) overlayEvent.preventDefault();
		});
	}

	// Mount newly-docked instances / unmount removed ones.
	useEffect(() => {
		if (!apiRef.current) return;
		for (const instance of dockedSurfaces) {
			if (mountedIdsRef.current.has(instance.id)) continue;
			const isPending = pendingDock?.instanceId === instance.id;
			mountPanel(instance, isPending ? pendingDock.position : undefined, isPending ? pendingDock.referenceGroupId : undefined);
			if (isPending) onPendingDockConsumed();
		}

		const dockedIds = new Set(dockedSurfaces.map((surface) => surface.id));
		for (const mountedId of mountedIdsRef.current) {
			if (dockedIds.has(mountedId)) continue;
			apiRef.current.getPanel(mountedId)?.api.close();
			mountedIdsRef.current.delete(mountedId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mountPanel is a stable closure over apiRef/mountedIdsRef, not reactive state
	}, [dockedSurfaces, pendingDock, onPendingDockConsumed]);

	// A docked Chat panel's awareness of its siblings, and the live
	// conversation data it renders, can change independently of the
	// mount/unmount effect above (a sibling gets docked/undocked, or the
	// draft/transcript updates) -- keep it live via updateParameters rather
	// than only setting it once at mount time.
	useEffect(() => {
		const api = apiRef.current;
		if (!api) return;
		const chatInstance = dockedSurfaces.find((surface) => surface.templateId === CHAT_TEMPLATE_ID);
		if (!chatInstance || !mountedIdsRef.current.has(chatInstance.id)) return;
		api.getPanel(chatInstance.id)?.api.updateParameters(chatParams(chatInstance));
		// eslint-disable-next-line react-hooks/exhaustive-deps -- chatParams is a stable closure over the same props already listed
	}, [dockedSurfaces, conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, onUndockChat, chatPinned, onTogglePinChat, closingIds]);

	// Pushes the fading-out `closing` flag live into every currently-mounted
	// panel's params (chat's own effect above already covers chat's case via
	// chatParams -- this one is for ordinary Surface Template panels).
	useEffect(() => {
		const api = apiRef.current;
		if (!api) return;
		for (const instance of dockedSurfaces) {
			if (instance.templateId === CHAT_TEMPLATE_ID || !mountedIdsRef.current.has(instance.id)) continue;
			api.getPanel(instance.id)?.api.updateParameters(surfaceTemplateParams(instance));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps -- surfaceTemplateParams is a stable closure over closingIds, already listed
	}, [dockedSurfaces, closingIds]);

	return (
		// themeLightSpaced/themeDarkSpaced (not themeLight/themeDark +
		// dockview-spaced as a separate class): the "Spaced" theme variants
		// merge the rounded/gapped layout mixin into the *same* CSS class as
		// the theme itself. That matters because dockview-core's base theme
		// mixin re-declares --dv-border-radius: 0px on the theme class
		// (.dv-shell.dockview-theme-light), which sits *inside* wherever our
		// own className would land (DockviewOptions.className is also a dead
		// end here -- dockview-core's gridview construction hard-resets that
		// element's className outright). A later-nested 0px redeclaration wins
		// over any outer ancestor's inherited 12px, confirmed by inspecting
		// the rendered DOM's computed --dv-border-radius, not assumed.
		<>
			<DockviewReact
				key={windowId}
				className="h-full"
				components={panelComponents}
				defaultTabComponent={defaultTabComponent}
				tabComponents={tabComponents}
				// No themeDarkSpaced exists -- themeAbyssSpaced is dockview's closest dark "Spaced" variant.
				theme={isDark ? themeAbyssSpaced : themeLightSpaced}
				onReady={onReady}
				onDidDrop={(event) => {
					const dataTransfer = event.nativeEvent instanceof DragEvent ? event.nativeEvent.dataTransfer : null;
					const templateId = dataTransfer?.getData(TEMPLATE_DRAG_MIME_TYPE);
					if (templateId) onExternalTemplateDrop(templateId, event.position, event.group?.id);
				}}
				watermarkComponent={() => <div className="grid h-full place-items-center p-6 text-center text-sm text-gray-500 dark:text-gray-400">Pull a Surface Template from the right pillar to dock it here.</div>}
			/>
			<SaveAsTemplateDialog
				open={saveAsTemplateRequest !== undefined}
				defaultTitle={saveAsTemplateRequest?.defaultTitle ?? ""}
				onClose={() => setSaveAsTemplateRequest(undefined)}
				onSave={(title) => {
					if (saveAsTemplateRequest) onSaveAsTemplate(saveAsTemplateRequest.templateId, title);
					setSaveAsTemplateRequest(undefined);
				}}
			/>
		</>
	);
}
