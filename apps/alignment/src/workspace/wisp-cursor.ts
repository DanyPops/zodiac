/** Pure position/style math for the Wisp Cursor -- a cosmetic indicator of where the agent is "going" during global (undocked) chat. */
export interface WispCursorPosition {
	x: number;
	y: number;
}

export interface WispCursorState {
	visible: boolean;
	/** Undefined while idle. */
	target?: WispCursorPosition;
}

export interface WispCursorStyle {
	opacity: number;
	transform: string;
	/** True only while idle, so the breathing animation never runs alongside real movement. */
	idle: boolean;
}

export function computeWispCursorStyle(state: WispCursorState, anchor: WispCursorPosition): WispCursorStyle {
	const position = state.target ?? anchor;
	return {
		opacity: state.visible ? 1 : 0,
		transform: `translate(${position.x}px, ${position.y}px)`,
		idle: state.target === undefined,
	};
}
