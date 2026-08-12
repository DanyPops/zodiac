/**
 * Driven port: where the pointer is, without the rest of the app touching
 * `window` directly. `createWindowPointerTracker()` is the only adapter; a
 * test supplies a fake that calls the callback directly.
 */
export interface PointerTracker {
	/** Subscribes to pointer movement; returns an unsubscribe function. */
	onMove: (callback: (clientY: number, viewportHeight: number) => void) => () => void;
}

export function createWindowPointerTracker(): PointerTracker {
	return {
		onMove(callback) {
			function handleMouseMove(event: MouseEvent): void {
				callback(event.clientY, window.innerHeight);
			}
			window.addEventListener("mousemove", handleMouseMove);
			return () => window.removeEventListener("mousemove", handleMouseMove);
		},
	};
}
