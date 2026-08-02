import { parseRpcLine, type PiRpcEvent } from "@danypops/pi-rpc-protocol";

/**
 * Driven port: the Chat surface's own view of "a live Pi agent to talk to,"
 * independent of HTTP/SSE. `createHttpPiClient` is its only adapter today,
 * proxied through Alignment's own dev server (see vite.config.ts's
 * piApiPlugin) rather than talking to a `pi` process directly -- the browser
 * never spawns or manages processes itself.
 */
export interface PiClient {
	createSession: (signal?: AbortSignal) => Promise<string>;
	sendPrompt: (sessionId: string, message: string, signal?: AbortSignal) => Promise<void>;
	/** Subscribes to a session's live event stream; returns an unsubscribe function that closes the underlying connection. */
	streamEvents: (sessionId: string, onEvent: (event: PiRpcEvent) => void, onError?: (error: unknown) => void) => () => void;
	abort: (sessionId: string, signal?: AbortSignal) => Promise<void>;
}

export interface CreatePiClientOptions {
	readonly fetcher?: typeof fetch;
	/** Injectable EventSource constructor, for tests -- defaults to the browser global. */
	readonly EventSourceCtor?: typeof EventSource;
}

export function createHttpPiClient(options: CreatePiClientOptions = {}): PiClient {
	const fetcher = options.fetcher ?? fetch;

	return {
		async createSession(signal) {
			const response = await fetcher("/api/pi/sessions", { method: "POST", signal });
			if (!response.ok) throw new Error(`pi-create-session:${response.status}`);
			const body = (await response.json()) as { sessionId?: unknown };
			if (typeof body.sessionId !== "string") throw new Error("pi-create-session:invalid-response");
			return body.sessionId;
		},

		async sendPrompt(sessionId, message, signal) {
			const response = await fetcher(`/api/pi/prompt?sessionId=${encodeURIComponent(sessionId)}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message }),
				signal,
			});
			if (!response.ok) throw new Error(`pi-send-prompt:${response.status}`);
		},

		async abort(sessionId, signal) {
			const response = await fetcher(`/api/pi/abort?sessionId=${encodeURIComponent(sessionId)}`, { method: "POST", signal });
			if (!response.ok) throw new Error(`pi-abort:${response.status}`);
		},

		streamEvents(sessionId, onEvent, onError) {
			// Resolved lazily, not at createHttpPiClient() call time -- a caller
			// that only uses createSession/sendPrompt/abort (e.g. a Node-side test)
			// must never require a browser-only global to exist just to construct
			// the client.
			const EventSourceCtor = options.EventSourceCtor ?? EventSource;
			const source = new EventSourceCtor(`/api/pi/events?sessionId=${encodeURIComponent(sessionId)}`);
			source.onmessage = (message) => {
				const event = parseRpcLine(message.data as string);
				if (event) onEvent(event);
			};
			source.onerror = (event) => {
				onError?.(event);
			};
			return () => source.close();
		},
	};
}
