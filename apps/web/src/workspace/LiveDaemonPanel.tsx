import { useState } from "react";
import { integrationId } from "@zodiac/protocol/ids";
import type { WorkspaceLifecycleEvent } from "../extensions/types.js";
import { useWorldClient } from "../world/use-world-client.js";
import { useOptimisticDock } from "../world/use-optimistic-dock.js";
import { useWorldExtensionEvents } from "../world/use-world-extension-events.js";
import { LiveWorldTiles } from "./LiveWorldTiles.js";

function noopEmit(): void {
	// No ExtensionHost wired up -- see LiveDaemonPanelProps.emitExtensionEvent's own doc comment.
}

/**
 * The whole "Live Daemon State" floating toggle + panel as one lazy-loaded
 * unit -- `computeTileRects` (@zodiac/server/window) and `connectRemoteWorldStore`
 * (@zodiac/server/world-client) are real, non-trivial code a first paint
 * doesn't need, the same reasoning App.tsx's own `WindowDockview` lazy
 * import already documents. Confirmed directly: importing this eagerly
 * pushed the entry chunk over apps/web's own bundle-size budget
 * (check:bundle-budget) by ~11kB gzip.
 *
 * "Dock Activity" demonstrates the identity/authority fix end to end: an
 * optimistic placeholder appears immediately, then either confirms (the
 * real WorldViewModel eventually reports the same surfaceId) or rolls back
 * with a real error (a collision, an invalid Window) -- see useOptimisticDock.
 */
export interface LiveDaemonPanelProps {
	readonly baseUrl: string;
	/** Fans this panel's own live WorldViewModel changes out to an ExtensionHost -- see useWorldExtensionEvents. Optional: omitted, this panel simply doesn't emit (no extension consumer wired up yet). */
	readonly emitExtensionEvent?: (event: WorkspaceLifecycleEvent) => void;
}

export function LiveDaemonPanel({ baseUrl, emitExtensionEvent }: LiveDaemonPanelProps): React.JSX.Element {
	const worldClient = useWorldClient(baseUrl);
	const [expanded, setExpanded] = useState(false);
	const optimisticDock = useOptimisticDock(baseUrl, worldClient.viewModel);
	useWorldExtensionEvents(worldClient.viewModel, emitExtensionEvent ?? noopEmit);
	const activeWorkspaceId = worldClient.viewModel.state === "ready" ? worldClient.viewModel.activeWorkspaceId : null;

	return (
		<div className="fixed bottom-2 right-2 z-50 max-w-md">
			<button
				type="button"
				onClick={() => setExpanded((current) => !current)}
				className="rounded-md border border-gray-400 bg-white/90 px-2 py-1 text-xs text-gray-700 shadow-sm dark:border-gray-600 dark:bg-black/70 dark:text-gray-300"
			>
				Live Daemon State {worldClient.connected ? "\u25cf" : "\u25cb"}
			</button>
			{expanded ? (
				<div className="mt-1 space-y-1">
					<LiveWorldTiles viewModel={worldClient.viewModel} connected={worldClient.connected} />
					{optimisticDock.pending.length > 0 ? (
						<ul data-testid="live-daemon-pending" className="text-xs text-gray-500 dark:text-gray-400">
							{optimisticDock.pending.map((entry) => (
								<li key={entry.surfaceId}>Docking &quot;{entry.title}&quot;\u2026</li>
							))}
						</ul>
					) : null}
					{optimisticDock.lastError ? (
						<p data-testid="live-daemon-dock-error" className="text-xs text-danger-80">
							{optimisticDock.lastError}
						</p>
					) : null}
					{activeWorkspaceId ? (
						<button
							type="button"
							data-testid="live-daemon-dock-activity"
							onClick={() => optimisticDock.dock({ workspaceId: activeWorkspaceId, integrationId: integrationId("activity"), title: "Activity" })}
							className="rounded-md border border-gray-400 bg-white/90 px-2 py-1 text-xs text-gray-700 shadow-sm dark:border-gray-600 dark:bg-black/70 dark:text-gray-300"
						>
							Dock Activity
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
