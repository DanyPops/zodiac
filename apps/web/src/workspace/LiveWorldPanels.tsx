import { useEffect } from "react";
import type { Panel } from "@zodiac/protocol";
import { useWorldClient } from "../world/use-world-client.js";

interface LiveWorldPanelsProps {
	readonly baseUrl: string;
	readonly onPanels: (panels: readonly Panel[]) => void;
}

/**
 * An invisible bridge, not a visible piece of chrome -- lazy-loaded (see
 * App.tsx's own `lazy()` call for it) so `useWorldClient`'s real dependency
 * (`@zodiac/server/world-client`'s full WorldStore implementation) stays out
 * of the critical entry bundle, the same reasoning WindowDockview/
 * LiveDaemonPanel already apply. Reports the live Panel list up via
 * `onPanels` whenever it changes; App.tsx's own default chrome placement
 * (see applet-slots.ts) already covers the gap before this chunk loads or
 * connects, so there's nothing else for this component to render itself.
 */
export function LiveWorldPanels({ baseUrl, onPanels }: LiveWorldPanelsProps): null {
	const world = useWorldClient(baseUrl);
	useEffect(() => {
		onPanels(world.panels);
	}, [world.panels, onPanels]);
	return null;
}
