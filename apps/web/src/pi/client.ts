import { parseRpcLine, type PiRpcEvent } from "@danypops/pi-rpc-protocol";

/**
 * Driven port: the Chat surface's own view of "a live Pi agent to talk to,"
 * independent of HTTP/SSE. `createHttpPiClient` is its only adapter today,
 * proxied through Zodiac's own dev server (see vite.config.ts's
 * piApiPlugin) rather than talking to a `pi` process directly -- the browser
 * never spawns or manages processes itself.
 */
export interface PiClientCreateSessionOptions {
	/** The spawned `pi --mode rpc` process's working directory -- lets a caller bind one session to a specific Workspace's project root. Omitted keeps today's default (the dev server's own cwd). */
	readonly cwd?: string;
}

export interface PiClient {
	createSession: (options?: PiClientCreateSessionOptions, signal?: AbortSignal) => Promise<string>;
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
		async createSession(createOptions, signal) {
			// A request body is only ever attached when there's something to say --
			// keeps the common no-options call identical to today's plain POST,
			// both on the wire and in every existing test that asserts its exact
			// shape.
			const requestBody = createOptions?.cwd ? JSON.stringify({ cwd: createOptions.cwd }) : undefined;
			const response = await fetcher("/api/pi/sessions", {
				method: "POST",
				...(requestBody ? { headers: { "Content-Type": "application/json" }, body: requestBody } : {}),
				signal,
			});
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
