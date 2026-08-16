import { useState } from "react";
import { useWorldClient } from "../world/use-world-client.js";
import { LiveWorldTiles } from "./LiveWorldTiles.js";

/**
 * The whole "Live Daemon State" floating toggle + panel as one lazy-loaded
 * unit -- `computeTileRects` (@zodiac/server/window) and `connectRemoteWorldStore`
 * (@zodiac/server/world-client) are real, non-trivial code a first paint
 * doesn't need, the same reasoning App.tsx's own `WindowDockview` lazy
 * import already documents. Confirmed directly: importing this eagerly
 * pushed the entry chunk over apps/web's own bundle-size budget
 * (check:bundle-budget) by ~11kB gzip.
 */
export function LiveDaemonPanel({ baseUrl }: { readonly baseUrl: string }): React.JSX.Element {
	const worldClient = useWorldClient(baseUrl);
	const [expanded, setExpanded] = useState(false);

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
				<div className="mt-1">
					<LiveWorldTiles viewModel={worldClient.viewModel} connected={worldClient.connected} />
				</div>
			) : null}
		</div>
	);
}
