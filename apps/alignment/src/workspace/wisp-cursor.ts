/**
 * Pure position/style math for the Wisp Cursor -- a purely cosmetic
 * indicator of where the agent is "going" during global (undocked) chat.
 * Real per-tool-call target resolution needs the Surface-binding model
 * (DockedSurfaceInstance has no bound-path/project-key field yet -- see
 * "Surface = client tool binding" task), so `target` stays optional: while
 * undefined, the cursor idles at its anchor instead of guessing where to go.
 */
export interface WispCursorPosition {
	x: number;
	y: number;
}

export interface WispCursorState {
	visible: boolean;
	/** Undefined while idle -- no known Surface/Workspace to drift toward yet. */
	target?: WispCursorPosition;
}

export interface WispCursorStyle {
	opacity: number;
	transform: string;
	/** True only while idle (no target) -- the component's breathing animation applies only here, off once actually drifting so the two effects never compete visually. */
	idle: boolean;
}

/** `state.visible` gates opacity; `state.target` (or `anchor` while idle) drives position. */
export function computeWispCursorStyle(state: WispCursorState, anchor: WispCursorPosition): WispCursorStyle {
	const position = state.target ?? anchor;
	return {
		opacity: state.visible ? 1 : 0,
		transform: `translate(${position.x}px, ${position.y}px)`,
		idle: state.target === undefined,
	};
}
