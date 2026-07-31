import { DockviewReact, positionToDirection, themeDark, themeLight, type DockviewReadyEvent, type IDockviewPanelProps, type Position } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useEffect, useRef } from "react";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import type { DockedSurfaceInstance } from "./model.js";
import { findSurfaceTemplate } from "./surface-templates.js";

// The debounced/idle-gated drop-preview policy the redesign settled on: a
// fast pass over several drop zones must not flicker a highlight on every
// one it crosses. Suppress the overlay unless the pointer's own velocity
// since the last sampled frame is at or below this threshold.
const DRAG_HINT_IDLE_VELOCITY_PX_PER_MS = 0.5;

// `IDockviewPanelProps` is dockview's own type (api/containerApi/params and
// more), not ours to mark readonly -- the rule can't see that `params` is the
// only field this component actually reads.
// eslint-disable-next-line sonarjs/prefer-read-only-props
function SurfaceTemplatePanel(props: IDockviewPanelProps<{ readonly templateId: string }>): React.JSX.Element {
	const template = findSurfaceTemplate(props.params.templateId);
	if (!template) return <div className="p-4 text-sm text-danger-80">Unknown Surface Template &quot;{props.params.templateId}&quot;.</div>;
	return <>{template.render()}</>;
}

const PANEL_COMPONENTS = { surfaceTemplate: SurfaceTemplatePanel };

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
	/** The user closed a tab via the docking engine's own UI -- undock it from the domain model too. */
	readonly onPanelClosed: (instanceId: string) => void;
	readonly onExternalTemplateDrop: (templateId: string, position: Position, referenceGroupId: string | undefined) => void;
	/** The active panel's docked-Surface instance id, or undefined when the Window is empty -- lets a caller (e.g. "save as template") know what's currently focused without reaching into dockview's own panel model. */
	readonly onActivePanelChange: (instanceId: string | undefined) => void;
	readonly isDark: boolean;
}

export function WindowDockview({ windowId, dockedSurfaces, pendingDock, onPendingDockConsumed, onPanelClosed, onExternalTemplateDrop, onActivePanelChange, isDark }: WindowDockviewProps): React.JSX.Element {
	const apiRef = useRef<DockviewReadyEvent["api"]>(undefined);
	const mountedIdsRef = useRef<Set<string>>(new Set());
	const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null);

	function mountPanel(instance: DockedSurfaceInstance, position?: Position, referenceGroupId?: string): void {
		const api = apiRef.current;
		if (!api) return;
		api.addPanel({
			id: instance.id,
			component: "surfaceTemplate",
			title: instance.title,
			params: { templateId: instance.templateId },
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
			if (!point || !last) return;
			const elapsedMs = Math.max(1, point.t - last.t);
			const velocity = Math.hypot(point.x - last.x, point.y - last.y) / elapsedMs;
			if (velocity > DRAG_HINT_IDLE_VELOCITY_PX_PER_MS) overlayEvent.preventDefault();
		});
	}

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
	}, [dockedSurfaces, pendingDock, onPendingDockConsumed]);

	return (
		<DockviewReact
			key={windowId}
			className="h-full"
			components={PANEL_COMPONENTS}
			theme={isDark ? themeDark : themeLight}
			onReady={onReady}
			onDidDrop={(event) => {
				const dataTransfer = event.nativeEvent instanceof DragEvent ? event.nativeEvent.dataTransfer : null;
				const templateId = dataTransfer?.getData(TEMPLATE_DRAG_MIME_TYPE);
				if (templateId) onExternalTemplateDrop(templateId, event.position, event.group?.id);
			}}
			watermarkComponent={() => <div className="grid h-full place-items-center p-6 text-center text-sm text-gray-500 dark:text-gray-400">Pull a Surface Template from the right pillar to dock it here.</div>}
		/>
	);
}
