/** Raised when no Client ever posted a result back before the timeout elapsed -- distinct from a Client posting back an empty/falsy result, which resolves normally. Presence-shaped by design (see the "Pi tool: list_visual_cues" Papyrus Task's own Figma/Yjs Awareness citations): "no Client observed" and "observed, reported nothing" are two different real outcomes, never conflated. */
export class NoClientObservedError extends Error {
	constructor(toolCallId: string, timeoutMs: number) {
		super(`No Client posted a result for toolCallId "${toolCallId}" within ${timeoutMs}ms`);
		this.name = "NoClientObservedError";
	}
}

export interface PendingClientActions {
	/**
	 * Registers a pending call keyed by `toolCallId` (Pi's own real per-tool-call
	 * id, reused as the correlation id here rather than inventing a second
	 * scheme -- see agent-routes.ts's own doc comment) and returns a Promise that
	 * resolves with whatever `resolve()` is later called with, or rejects with
	 * `NoClientObservedError` once `timeoutMs` elapses with nothing posted.
	 */
	register(toolCallId: string, timeoutMs?: number): Promise<unknown>;
	/** Resolves a pending registration with `result`. Returns false (a no-op, not an error) if nothing is currently pending for this toolCallId -- a late or duplicate POST is a real, expected race, never a 500. */
	resolve(toolCallId: string, result: unknown): boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * The daemon-side half of the Client-initiated round trip `list_visual_cues`'s
 * own `RemoteBrowserVisualCueClient` depends on: the tool's own `execute()`
 * calls `register()` and awaits it; the Client -- having observed a real
 * `tool-call-start` SSE event naming this same toolCallId, on its own
 * initiative, the same direction every other Client-originated call in this
 * codebase already goes -- POSTs its own result to a route that calls
 * `resolve()`. Never a daemon-initiated broadcast-and-race (see this task's
 * own design-history section for why that shape was rejected).
 */
export function createPendingClientActions(): PendingClientActions {
	const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

	return {
		register(toolCallId, timeoutMs = DEFAULT_TIMEOUT_MS) {
			return new Promise((resolvePromise, rejectPromise) => {
				const timer = setTimeout(() => {
					pending.delete(toolCallId);
					rejectPromise(new NoClientObservedError(toolCallId, timeoutMs));
				}, timeoutMs);
				pending.set(toolCallId, {
					resolve: (value) => {
						clearTimeout(timer);
						pending.delete(toolCallId);
						resolvePromise(value);
					},
					reject: (error) => {
						clearTimeout(timer);
						pending.delete(toolCallId);
						rejectPromise(error);
					},
				});
			});
		},
		resolve(toolCallId, result) {
			const entry = pending.get(toolCallId);
			if (!entry) return false;
			entry.resolve(result);
			return true;
		},
	};
}
