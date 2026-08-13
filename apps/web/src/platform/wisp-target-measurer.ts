import { centroidOf, type Point } from "./geometry.js";

/**
 * Driven port: measures the on-screen offset between the Wisp Cursor's
 * static idle anchor and a Window Carousel pill, without the rest of the
 * app touching `window`/`document` directly.
 */
export interface WispTargetMeasurer {
	measure: (windowIndex: number) => Point | undefined;
	onResize: (callback: () => void) => () => void;
}

export function createDomWispTargetMeasurer(): WispTargetMeasurer {
	return {
		measure(windowIndex) {
			const anchor = document.querySelector<HTMLElement>("[data-wisp-cursor-anchor]");
			const button = document.querySelector<HTMLElement>(`[aria-label="Windows"] [data-window-index="${windowIndex}"]`);
			if (!anchor || !button) return undefined;
			const anchorCenter = centroidOf(anchor.getBoundingClientRect());
			const buttonCenter = centroidOf(button.getBoundingClientRect());
			return { x: buttonCenter.x - anchorCenter.x, y: buttonCenter.y - anchorCenter.y };
		},
		onResize(callback) {
			window.addEventListener("resize", callback);
			return () => window.removeEventListener("resize", callback);
		},
	};
}
