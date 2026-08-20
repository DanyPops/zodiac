import { listCues } from "@zodiac/ui/cues";

export interface VisualCueClientActionEvent {
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly input: unknown;
}

const LIST_VISUAL_CUES_TOOL_NAME = "list_visual_cues";

/**
 * The browser-side half of the round trip `list_visual_cues`'s own
 * `RemoteBrowserVisualCueClient` depends on (see the "Pi tool:
 * list_visual_cues" Papyrus Task) -- watches for a real tool-call-start
 * event naming this exact tool, calls the real, live `listCues()` (the same
 * DOM-free registry every mounted gallery card registers itself into), and
 * posts the result back on this Client's own initiative, the same direction
 * every other Client-originated call in this codebase already goes.
 *
 * Deliberately generic in its own calling convention (a plain event-handler
 * function, not tied to PiChatController's own internals) so it can be
 * wired via `PiChatControllerOptions.onToolCall` without that controller
 * ever needing to know this tool, or any other, by name.
 */
export function createVisualCueClientActionHandler(postClientAction: (sessionId: string, toolCallId: string, result: unknown) => Promise<void>): (event: VisualCueClientActionEvent) => void {
	return (event) => {
		if (event.toolName !== LIST_VISUAL_CUES_TOOL_NAME) return;
		void postClientAction(event.sessionId, event.toolCallId, { cues: listCues() }).catch((error: unknown) => {
			// A failed POST-back just means RemoteBrowserVisualCueClient's own
			// register() eventually times out with NoClientObservedError instead
			// of getting this Client's real answer -- a real, already-handled
			// outcome on the daemon side (see pending-client-actions.ts), not a
			// crash worth propagating here.
			console.error("visual-cue-client-action: failed to post list_visual_cues result back", error);
		});
	};
}
