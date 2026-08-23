import { CHAT_TEMPLATE_ID, type DockedSurfaceInstance } from "../workspace/model.js";

/** Chat's own synthetic docked-Surface entry for one Window. Chat stays a client-local concept (never migrated to the daemon's real Window.surfaces), so this is derived on the fly, not read from stored per-Workspace state. Undefined once that window's own Chat has been explicitly closed. */
export function chatDockedSurfaceFor(windowId: string | undefined, closedChatWindowIds: ReadonlySet<string>): DockedSurfaceInstance | undefined {
	if (!windowId || closedChatWindowIds.has(windowId)) return undefined;
	return { id: `chat-${windowId}`, templateId: CHAT_TEMPLATE_ID, title: "Chat" };
}
