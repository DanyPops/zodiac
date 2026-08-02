/** Driven port: global pointer move/up during a drag gesture, without the rest of the app touching `window` directly. */
export interface DragTracker {
	onMove: (callback: (clientX: number, clientY: number) => void) => () => void;
	onUp: (callback: () => void) => () => void;
}

export function createWindowDragTracker(): DragTracker {
	return {
		onMove(callback) {
			function handlePointerMove(event: PointerEvent): void {
				callback(event.clientX, event.clientY);
			}
			window.addEventListener("pointermove", handlePointerMove);
			return () => window.removeEventListener("pointermove", handlePointerMove);
		},
		onUp(callback) {
			window.addEventListener("pointerup", callback);
			return () => window.removeEventListener("pointerup", callback);
		},
	};
}
