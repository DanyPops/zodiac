import * as ContextMenu from "@radix-ui/react-context-menu";
import { DockviewDefaultTab, DockviewReact, positionToDirection, themeAbyssSpaced, themeLightSpaced, type DockviewDidDropEvent, type DockviewReadyEvent, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type Position } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { Feather, PanelLeftOpen, Pin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConversationSurface } from "../conversation/ConversationSurface.js";
import type { ConversationItem } from "../conversation/projector.js";
import { cn } from "../platform/cn.js";
import { toLocalRect, type Rect } from "../platform/geometry.js";
import { SURFACE_BG } from "../platform/surface-style.js";
import { DockRuler } from "./DockRuler.js";
import { computeDockRulerHint, dockRulerFrameMark, type DockRulerFrameMark, type DockRulerHint } from "./dock-ruler.js";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import { ACTIVE_ZONE_CEILING_OPACITY, computeDropZones, dropZoneCloseness, dropZoneOpacity, proximityInfluenceRadius, type DropZone } from "./proximity-zones.js";
import { ProximityDropZones } from "./ProximityDropZones.js";
import { CHAT_TEMPLATE_ID, type DockedSurfaceInstance } from "./model.js";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog.js";
import { isSurfaceFocused } from "./surface-focus.js";
import { findSurfaceTemplate, type SurfaceTemplateDefinition } from "./surface-templates.js";

// How long the fade-out plays before the panel is actually removed from
// dockview -- matches --animate-surface-spawn's own scale but a touch
// slower, since closing reads calmer as a slightly longer fade than the
// spawn's snappier entrance.
const CLOSE_FADE_MS = 220;

// Shared idle-velocity gate for onWillShowOverlay below, every kind.
const DRAG_HINT_IDLE_VELOCITY_PX_PER_MS = 0.5;

// A fresh `() => {}` as a prop default is recreated every render -- fatal
// when it feeds a useEffect dependency array (the dragActive cleanup effect
// below): each render creates a new default, changing the dep, re-running
// the effect, whose setState calls (new [] / new Map() each time) trigger
// another render, forever. One stable module-level reference instead.
function noop(): void {}

// dockview-react's own DockviewReact rebuilds its internal watermark part
// (a real DOM replacement, not just a re-render) whenever watermarkComponent
// changes identity -- see its own useEffect keyed on that exact prop. An
// inline arrow function here is a fresh identity every WindowDockview
// render, so anything that makes this component re-render during a live
// drag (the ambient proximity layer below, or the Dock Ruler before it)
// would replace the watermark's DOM node mid-gesture -- a real, confirmed
// regression: it silently corrupts a genuine native browser drag targeting
// that exact node (a real mouse drag onto the empty watermark stopped
// docking anything), invisible to dispatchEvent-based tests since those
// re-resolve their target fresh at dispatch time instead of tracking one
// DOM node's identity across a whole gesture. A stable module-level
// reference, not recreated per render, avoids it entirely.
function DockWatermark(): React.JSX.Element {
	return <div className="grid h-full place-items-center p-6 text-center text-sm text-gray-500 dark:text-gray-400">Pull a Surface Template from the right pillar to dock it here.</div>;
}

/** The same hint computation the Dock Ruler renders, run fresh against a real drag event and its target group's own DOM box -- shared between the live overlay (onWillShowOverlay) and the actual drop (onDidDrop) so what the ruler showed and what the drop does can never disagree. */
function dockRulerHintFromEvent(nativeEvent: DragEvent | PointerEvent | Event, groupElement: HTMLElement): DockRulerHint | undefined {
	if (!(nativeEvent instanceof DragEvent) && !(nativeEvent instanceof PointerEvent)) return undefined;
	const box = groupElement.getBoundingClientRect();
	return computeDockRulerHint(nativeEvent.clientX - box.left, nativeEvent.clientY - box.top, box.width, box.height);
}

/** Pointer speed since lastMoveRef's last sample, updating it as a side effect. Infinity with no point to measure or no prior sample yet -- wait for confirmed low velocity before showing anything, not "show until proven fast". Shared by both onWillShowOverlay branches below. */
function sampleDragVelocity(nativeEvent: DragEvent | PointerEvent | Event, lastMoveRef: { current: { x: number; y: number; t: number } | null }): number {
	const point = nativeEvent instanceof DragEvent || nativeEvent instanceof PointerEvent ? { x: nativeEvent.clientX, y: nativeEvent.clientY, t: Date.now() } : null;
	const last = lastMoveRef.current;
	if (point) lastMoveRef.current = point;
	if (!point || !last) return Infinity;
	return Math.hypot(point.x - last.x, point.y - last.y) / Math.max(1, point.t - last.t);
}

interface SurfaceTemplatePanelParams {
	readonly templateId: string;
	/** True while fading out, just before the panel is actually removed -- see requestClose. */
	readonly closing?: boolean;
	/** False while a sibling Surface (in a split, not a hidden tab -- see surface-focus.ts) is the Window's active panel. The "via defocus" half of the shared animation language: a steady-state dim, not a one-shot transition. */
	readonly focused?: boolean;
}

/** Combines the two opacity states a docked panel can be in -- closing (fading all the way out) always wins over a mere defocus dim, since a closing panel shouldn't visually settle at the dimmed level first. */
function panelOpacityClassName(closing: boolean | undefined, focused: boolean | undefined): string {
	if (closing) return "opacity-0";
	if (focused === false) return "opacity-90";
	return "opacity-100";
}

function makeSurfaceTemplatePanel(extensionTemplates: readonly SurfaceTemplateDefinition[]) {
	return function SurfaceTemplatePanel(props: IDockviewPanelProps<SurfaceTemplatePanelParams>): React.JSX.Element {
		const template = findSurfaceTemplate(props.params.templateId, extensionTemplates);
		const content = !template ? <div className="p-4 text-sm text-danger-80">Unknown Surface Template &quot;{props.params.templateId}&quot;.</div> : <>{template.render()}</>;
		return (
			// animate-surface-spawn plays once on mount (a bubble-expand-in); the
			// opacity transition below activates later, on close or defocus -- the
			// spawn animation and an opacity change never run at the same time in
			// practice.
			<div className={cn("h-full animate-surface-spawn transition-opacity duration-[220ms] motion-reduce:animate-none", panelOpacityClassName(props.params.closing, props.params.focused))}>{content}</div>
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
	/** False while a sibling Surface (in a split, not a hidden tab) is the Window's active panel -- see surface-focus.ts. */
	readonly focused: boolean;
}

// eslint-disable-next-line sonarjs/prefer-read-only-props -- see SurfaceTemplatePanel above
function DockedChatPanel(props: IDockviewPanelProps<DockedChatParams>): React.JSX.Element {
	const { conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, siblingTitles, onUndock, pinned, closing, focused } = props.params;
	return (
		// animate-chat-follow-bounce and animate-surface-spawn both play once on
		// mount (a fresh mount happens naturally every time Chat relocates to a
		// new active Window, each Window its own DockviewReact instance) -- the
		// opacity transition activates later, on close or defocus.
		<div className={cn("flex h-full min-h-0 flex-col animate-surface-spawn transition-opacity duration-[220ms] motion-reduce:animate-none", !pinned && "animate-chat-follow-bounce", panelOpacityClassName(closing, focused))}>
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
	/** The fraction of the reference group's current size (along whichever axis `position` implies) this Surface should occupy -- chosen via the Dock Ruler during a drag. Undefined for placements with no drag geometry to derive one from (click-to-dock, the keyboard TemplatesDialog flow), which fall back to dockview's own default split size. */
	newGroupSizeRatio?: number;
}

interface WindowDockviewProps {
	/** Remounts the whole docking engine when the active Window changes -- each Window owns its own independent arrangement. */
	readonly windowId: string;
	readonly dockedSurfaces: readonly DockedSurfaceInstance[];
	readonly pendingDock?: PendingDock;
	readonly onPendingDockConsumed: () => void;
	/** The user closed a tab via the docking engine's own UI -- undock it from the domain model too (or float it, for Chat). */
	readonly onPanelClosed: (instanceId: string) => void;
	readonly onExternalTemplateDrop: (templateId: string, position: Position, referenceGroupId: string | undefined, newGroupSizeRatio: number | undefined) => void;
	/** The Dock Ruler's outer frame (DockRulerFrame, rendered outside this Window's own overflow-hidden canvas by a parent) needs the live hint too, converted into an absolute page-space mark -- undefined outside a drag, or once the pointer leaves the target. */
	readonly onDockRulerHintChange?: (mark: DockRulerFrameMark | undefined) => void;
	/** App.tsx's own templateDragging -- true for a Surface Template drag's entire duration, regardless of where it started or how it concludes. Used only to force-clear the in-content Dock Ruler shade once a drag ends by any means other than a drop or the pointer visibly leaving (a cancelled drag, or one dropped outside any valid target) -- see the effect below. */
	readonly dragActive?: boolean;
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
	onDockRulerHintChange = noop,
	dragActive = false,
	onActivePanelChange = noop,
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
	const wrapperRef = useRef<HTMLDivElement>(null);
	const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);
	// Own idle-velocity sample, independent of lastMoveRef above -- the ambient
	// proximity layer (below) is driven by a plain native dragover listener,
	// not dockview's onWillShowOverlay, so sharing one ref would double-sample
	// the same native event and corrupt both gates' velocity readings.
	const zoneLastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);
	// The group id (if any) onWillShowOverlay's own content-kind branch most
	// recently ran for -- onDidDrop reads this to tell a real content drop
	// (recompute a split) apart from a header/tab-strip drop (defer to
	// dockview's own reported position). Real fix for a reported bug: dropping
	// onto a group's own header used to still recompute a split from raw
	// clientY against the group's *whole* element (header included), since
	// DockviewDidDropEvent carries no `kind` of its own to check directly.
	const contentHoverGroupIdRef = useRef<string | undefined>(undefined);
	// dockview's own real root-edge classification (onWillShowOverlay's kind
	// === "edge", no group of its own) -- the ambient listener below is a
	// separate native dragover listener with its own independent geometry math
	// (computeDockRulerHint against whichever group's rect the raw pointer
	// happens to sit inside), which has no way to know dockview itself will
	// actually perform a *root-level* split there instead of a split inside
	// that group -- a real, reported bug: a group thin enough (or close enough
	// to the canvas's own edge) that dockview reclassifies a content hover as
	// a root edge still lit up its own small per-group zone brightest (pure
	// centroid-distance proximity, unaware of the reclassification), promising
	// a modest in-group split that dropping there would never actually produce.
	const rootEdgeHintRef = useRef<Position | undefined>(undefined);
	const [saveAsTemplateRequest, setSaveAsTemplateRequest] = useState<{ templateId: string; defaultTitle: string } | undefined>(undefined);
	// The live Dock Ruler overlay's own position/hint while dragging over an
	// existing group's content -- undefined outside a drag, or once the
	// pointer leaves the target or drops.
	const [dockRulerBox, setDockRulerBox] = useState<(Rect & { hint: DockRulerHint }) | undefined>(undefined);
	// Every possible drop position for the current drag (see computeDropZones)
	// and each one's own current breathing-peak opacity -- the ambient,
	// always-on-during-a-drag layer, distinct from dockRulerBox above which
	// only appears once the pointer is inside one specific group's content.
	const [dropZones, setDropZones] = useState<readonly DropZone[]>([]);
	const [dropZoneOpacities, setDropZoneOpacities] = useState<ReadonlyMap<string, number>>(new Map());
	// Ids currently mid-fade, just before their real dockview removal --
	// requestClose below owns the whole lifecycle (mark closing, wait
	// CLOSE_FADE_MS, then the real api.close()).
	const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(new Set());
	// The Window's currently active panel (a real split's focused pane, not a
	// hidden tab -- dockview unmounts a tab's content entirely on switch, so
	// there's nothing to dim there) -- drives the "via defocus" half of the
	// shared animation language via surface-focus.ts's isSurfaceFocused.
	const [activePanelId, setActivePanelId] = useState<string | undefined>(undefined);

	// A drag can end without ever dropping onto this Window -- cancelled via
	// Escape, or dropped outside any valid target entirely. onDragLeave only
	// clears the ruler once the pointer visibly leaves the wrapper, and
	// onDidDrop only clears it on a real drop -- neither covers a drag that
	// simply ends in place. dragActive (App.tsx's own templateDragging,
	// already cleared unconditionally on the pillar's own dragend regardless
	// of where or how the drag concluded) catches exactly that gap. Found
	// live: a real, reported degradation -- the in-content shade (DockRuler)
	// stayed visible indefinitely after a cancelled drag, since nothing else
	// ever cleared dockRulerBox for it.
	useEffect(() => {
		if (dragActive) return;
		contentHoverGroupIdRef.current = undefined;
		rootEdgeHintRef.current = undefined;
		setDockRulerBox(undefined);
		onDockRulerHintChange(undefined);
		setDropZones([]);
		setDropZoneOpacities(new Map());
	}, [dragActive, onDockRulerHintChange]);

	// The ambient proximity layer: a plain native dragover listener on the
	// whole wrapper, independent of dockview's own onWillShowOverlay (which
	// only fires for regions dockview itself recognizes as drop targets, not
	// necessarily the empty watermark or the gaps between groups). Idle-gated
	// like the ruler above, for the same reason -- getBoundingClientRect() per
	// group on every unthrottled dragover is exactly the fast-drag hang this
	// codebase already fixed once.
	useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper || !dragActive) return;
		function onDragOver(nativeEvent: DragEvent): void {
			if (sampleDragVelocity(nativeEvent, zoneLastMoveRef) > DRAG_HINT_IDLE_VELOCITY_PX_PER_MS) return;
			const api = apiRef.current;
			if (!wrapper || !api) return;
			const wrapperBox = wrapper.getBoundingClientRect();
			const canvasRect = { left: 0, top: 0, width: wrapperBox.width, height: wrapperBox.height };
			const groups = api.groups.map((group) => {
				const box = group.element.getBoundingClientRect();
				return { id: group.id, rect: toLocalRect(box, wrapperBox) };
			});
			const zones = computeDropZones(groups, canvasRect);
			const pointer = { x: nativeEvent.clientX - wrapperBox.left, y: nativeEvent.clientY - wrapperBox.top };
			const radius = proximityInfluenceRadius(canvasRect);

			// The Dock Ruler (content-kind onWillShowOverlay, above) shows its own
			// live-fraction highlight for whichever exact position the pointer
			// currently favors within a hovered group -- recomputed independently
			// here (not read from the other listener's own state, see this
			// effect's own comment on why) with the same computeDockRulerHint used
			// there. Excluding that one ambient zone avoids showing two
			// disagreeing rectangles for the same position: a static half-of-group
			// guess next to the Ruler's own live, precise one.
			const hoveredGroup = groups.find((group) => pointer.x >= group.rect.left && pointer.x <= group.rect.left + group.rect.width && pointer.y >= group.rect.top && pointer.y <= group.rect.top + group.rect.height);
			const activeHint = hoveredGroup ? computeDockRulerHint(pointer.x - hoveredGroup.rect.left, pointer.y - hoveredGroup.rect.top, hoveredGroup.rect.width, hoveredGroup.rect.height) : undefined;
			const suppressedZoneId = hoveredGroup && activeHint ? `${hoveredGroup.id}:${activeHint.edge}` : undefined;

			// dockview's own real classification overrides our own geometry guess
			// above whenever they disagree -- see rootEdgeHintRef's own comment.
			// The nearby group's zone for that same direction is just as misleading
			// as the one the Ruler already suppresses, so it's excluded the same
			// way; the matching root zone gets promoted to the Ruler's own
			// confirmed-target brightness instead of a mere proximity guess, since
			// dockview will actually perform exactly that split.
			const rootEdgePosition = rootEdgeHintRef.current;
			const edgeSuppressedZoneId = hoveredGroup && rootEdgePosition ? `${hoveredGroup.id}:${rootEdgePosition}` : undefined;
			const visibleZones = zones.filter((zone) => zone.id !== suppressedZoneId && zone.id !== edgeSuppressedZoneId);

			setDropZones(visibleZones);
			const opacities = new Map(visibleZones.map((zone) => [zone.id, dropZoneOpacity(dropZoneCloseness(pointer, zone, radius))]));
			if (rootEdgePosition) opacities.set(`root:${rootEdgePosition}`, ACTIVE_ZONE_CEILING_OPACITY);
			setDropZoneOpacities(opacities);
		}
		wrapper.addEventListener("dragover", onDragOver);
		return () => wrapper.removeEventListener("dragover", onDragOver);
	}, [dragActive]);

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
			focused: isSurfaceFocused(instance.id, activePanelId, dockedSurfaces.length),
		};
	}

	function surfaceTemplateParams(instance: DockedSurfaceInstance): SurfaceTemplatePanelParams {
		return { templateId: instance.templateId, closing: closingIds.has(instance.id), focused: isSurfaceFocused(instance.id, activePanelId, dockedSurfaces.length) };
	}

	function mountPanel(instance: DockedSurfaceInstance, position?: Position, referenceGroupId?: string, newGroupSizeRatio?: number): void {
		const api = apiRef.current;
		if (!api) return;
		const isChat = instance.templateId === CHAT_TEMPLATE_ID;
		// The Dock Ruler's chosen fraction, converted into dockview's own
		// initialWidth/initialHeight (its real, documented addPanel option for
		// sizing the newly-created group) -- measured off the reference group's
		// own current size, not the ruler's drag-time snapshot, since a real
		// resize could happen between drop and this mount effect running.
		const referenceGroup = referenceGroupId ? api.getGroup(referenceGroupId) : undefined;
		const initialWidth = newGroupSizeRatio !== undefined && referenceGroup && (position === "left" || position === "right") ? referenceGroup.width * newGroupSizeRatio : undefined;
		const initialHeight = newGroupSizeRatio !== undefined && referenceGroup && (position === "top" || position === "bottom") ? referenceGroup.height * newGroupSizeRatio : undefined;
		api.addPanel({
			id: instance.id,
			component: isChat ? "chatSurface" : "surfaceTemplate",
			title: instance.title,
			params: isChat ? chatParams(instance) : surfaceTemplateParams(instance),
			position: position ? { direction: positionToDirection(position), referenceGroup: referenceGroupId } : undefined,
			initialWidth,
			initialHeight,
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

		setActivePanelId(event.api.activePanel?.id);
		event.api.onDidActivePanelChange((change) => {
			setActivePanelId(change.panel?.id);
			onActivePanelChange(change.panel?.id);
		});

		// dockview rejects an external (non-dockview-panel) drag's drop-target
		// overlay by default -- a consumer must explicitly accept it. Only
		// accept drags actually carrying our own template MIME type, not any
		// arbitrary external drag (an image, a link) a user might drop in.
		event.api.onUnhandledDragOver((dndEvent) => {
			const dataTransfer = dndEvent.nativeEvent instanceof DragEvent ? dndEvent.nativeEvent.dataTransfer : null;
			if (dataTransfer?.types.includes(TEMPLATE_DRAG_MIME_TYPE)) dndEvent.accept();
		});

		event.api.onWillShowOverlay((overlayEvent) => {
			// Real-time root-edge classification for the ambient listener above,
			// unconditional (not idle-gated) -- always the freshest ground truth
			// regardless of which branch below actually renders anything.
			rootEdgeHintRef.current = overlayEvent.kind === "edge" ? overlayEvent.position : undefined;

			// Dock Ruler: a granular overlay for an existing group's content,
			// replacing dockview's own coarse quadrant one (hidden via CSS).
			// No preventDefault -- onDrop still needs to fire; onDidDrop below
			// recomputes the same hint fresh instead of trusting dockview's own.
			if (overlayEvent.kind === "content" && overlayEvent.group) {
				// Idle-gated like the branch below (used to run unthrottled on
				// every dragover -- a real, reported hang during a fast drag).
				if (sampleDragVelocity(overlayEvent.nativeEvent, lastMoveRef) > DRAG_HINT_IDLE_VELOCITY_PX_PER_MS) return;

				const wrapper = wrapperRef.current;
				const hint = wrapper ? dockRulerHintFromEvent(overlayEvent.nativeEvent, overlayEvent.group.element) : undefined;
				if (!hint || !wrapper) {
					contentHoverGroupIdRef.current = undefined;
					setDockRulerBox(undefined);
					onDockRulerHintChange(undefined);
					return;
				}
				contentHoverGroupIdRef.current = overlayEvent.group.id;
				const groupBox = overlayEvent.group.element.getBoundingClientRect();
				const wrapperBox = wrapper.getBoundingClientRect();
				setDockRulerBox({ ...toLocalRect(groupBox, wrapperBox), hint });
				onDockRulerHintChange(dockRulerFrameMark(hint, groupBox));
				return;
			}

			// Every other kind (root-level edge overlay, tab/header_space). The
			// "Spaced" theme's overlay anchor persists across frames once shown,
			// so an unsuppressed fast frame stays visible through the rest of a
			// fast pass even if every later frame is correctly suppressed.
			contentHoverGroupIdRef.current = undefined;
			setDockRulerBox(undefined);
			onDockRulerHintChange(undefined);
			if (sampleDragVelocity(overlayEvent.nativeEvent, lastMoveRef) > DRAG_HINT_IDLE_VELOCITY_PX_PER_MS) overlayEvent.preventDefault();
		});
	}

	// Mount newly-docked instances / unmount removed ones.
	useEffect(() => {
		if (!apiRef.current) return;
		for (const instance of dockedSurfaces) {
			if (mountedIdsRef.current.has(instance.id)) continue;
			const isPending = pendingDock?.instanceId === instance.id;
			mountPanel(instance, isPending ? pendingDock.position : undefined, isPending ? pendingDock.referenceGroupId : undefined, isPending ? pendingDock.newGroupSizeRatio : undefined);
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
	}, [dockedSurfaces, conversationItems, conversationLoading, conversationError, draft, onDraftChange, onComposerFocus, onUndockChat, chatPinned, onTogglePinChat, closingIds, activePanelId]);

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
		// eslint-disable-next-line react-hooks/exhaustive-deps -- surfaceTemplateParams is a stable closure over closingIds/activePanelId, already listed
	}, [dockedSurfaces, closingIds, activePanelId]);

	// Memoized -- see DockWatermark's own comment above on why an unstable
	// identity here is a real correctness bug, not just a wasted re-render.
	const handleDidDrop = useCallback(
		(event: DockviewDidDropEvent) => {
			const dataTransfer = event.nativeEvent instanceof DragEvent ? event.nativeEvent.dataTransfer : null;
			const templateId = dataTransfer?.getData(TEMPLATE_DRAG_MIME_TYPE);
			const hoveredGroupId = contentHoverGroupIdRef.current;
			contentHoverGroupIdRef.current = undefined;
			setDockRulerBox(undefined);
			onDockRulerHintChange(undefined);
			setDropZones([]);
			setDropZoneOpacities(new Map());
			if (!templateId) return;
			// Recompute the same hint fresh, rather than trusting dockview's own
			// reported `event.position` -- its quadrant thresholds are much
			// narrower than the Dock Ruler's, so they can disagree near the
			// pane's own center. Only for a drop actually preceded by a
			// content-kind hover for this exact group -- DockviewDidDropEvent
			// carries no `kind` of its own, so without this check a header/tab-
			// strip drop's clientY (still "inside" the group's *whole* element,
			// header included) would get recomputed as a bogus split instead of
			// deferring to dockview's own correct tab-insert. Falls back to
			// dockview's own position/no ratio for that case, or when there's no
			// group to measure (the empty-Window watermark).
			const hint = event.group && event.group.id === hoveredGroupId ? dockRulerHintFromEvent(event.nativeEvent, event.group.element) : undefined;
			if (!hint) {
				onExternalTemplateDrop(templateId, event.position, event.group?.id, undefined);
				return;
			}
			const newGroupSizeRatio = hint.edge === "left" || hint.edge === "top" ? hint.guide.ratio : 1 - hint.guide.ratio;
			onExternalTemplateDrop(templateId, hint.edge, event.group?.id, newGroupSizeRatio);
		},
		[onDockRulerHintChange, onExternalTemplateDrop, setDockRulerBox, setDropZones, setDropZoneOpacities],
	);

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
			<div
				ref={wrapperRef}
				data-testid="window-dockview-wrapper"
				className="relative h-full"
				onDragLeave={(event) => {
					// dragleave fires when moving between a wrapper's own children too --
					// only actually clear the ruler once the pointer has left the whole
					// wrapper, not just crossed an internal element boundary.
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
						setDockRulerBox(undefined);
						onDockRulerHintChange(undefined);
						setDropZones([]);
						setDropZoneOpacities(new Map());
					}
				}}
			>
				<DockviewReact
					key={windowId}
					className="h-full"
					components={panelComponents}
					defaultTabComponent={defaultTabComponent}
					tabComponents={tabComponents}
					// No themeDarkSpaced exists -- themeAbyssSpaced is dockview's closest dark "Spaced" variant.
					theme={isDark ? themeAbyssSpaced : themeLightSpaced}
					onReady={onReady}
					onDidDrop={handleDidDrop}
					watermarkComponent={DockWatermark}
				/>
				{dropZones.length > 0 && <ProximityDropZones zones={dropZones} zoneOpacities={dropZoneOpacities} />}
				{dockRulerBox && (
					// pointer-events-none: this wrapper fully covers the hovered group's own
					// content while a real drag is in progress -- without it, a genuine
					// native drop's own hit-test resolves here (a plain div with no drop
					// handling) instead of dockview's own content element underneath,
					// silently swallowing the drop. DockRuler's own children were already
					// pointer-events-none; this wrapper itself wasn't.
					<div className="pointer-events-none absolute" style={{ left: dockRulerBox.left, top: dockRulerBox.top, width: dockRulerBox.width, height: dockRulerBox.height }}>
						<DockRuler width={dockRulerBox.width} height={dockRulerBox.height} hint={dockRulerBox.hint} />
					</div>
				)}
			</div>
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
