/**
 * Driven port: measures the on-screen offset between the Wisp Cursor's
 * static idle anchor and a Window Carousel pill, without the rest of the
 * app touching `window`/`document` directly.
 */
export interface WispTargetMeasurer {
	measure: (windowIndex: number) => { x: number; y: number } | undefined;
	onResize: (callback: () => void) => () => void;
}

export function createDomWispTargetMeasurer(): WispTargetMeasurer {
	return {
		measure(windowIndex) {
			const anchor = document.querySelector<HTMLElement>("[data-wisp-cursor-anchor]");
			const button = document.querySelector<HTMLElement>(`[aria-label="Windows"] [data-window-index="${windowIndex}"]`);
			if (!anchor || !button) return undefined;
			const anchorRect = anchor.getBoundingClientRect();
			const buttonRect = button.getBoundingClientRect();
			return {
				x: buttonRect.left + buttonRect.width / 2 - (anchorRect.left + anchorRect.width / 2),
				y: buttonRect.top + buttonRect.height / 2 - (anchorRect.top + anchorRect.height / 2),
			};
		},
		onResize(callback) {
			window.addEventListener("resize", callback);
			return () => window.removeEventListener("resize", callback);
		},
	};
}
