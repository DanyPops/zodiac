import type { ConversationItem } from "../conversation/projector.js";
import { findDockedSurfaceForToolName, type Workspace } from "./model.js";

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

/** The most recent tool-call item's tool name, or undefined if none has happened yet. */
export function latestToolCallName(items: readonly ConversationItem[]): string | undefined {
	for (let i = items.length - 1; i >= 0; i -= 1) {
		const item = items[i];
		if (item?.kind === "tool-call") return item.toolName;
	}
	return undefined;
}

/** Which Window index (if any) the most recent tool call correlates to, via a bound docked Surface. */
export function resolveWispWindowIndex(workspace: Workspace, toolName: string | undefined): number | undefined {
	if (toolName === undefined) return undefined;
	const found = findDockedSurfaceForToolName(workspace, toolName);
	if (!found) return undefined;
	const index = workspace.windows.findIndex((window) => window.id === found.window.id);
	return index === -1 ? undefined : index;
}
