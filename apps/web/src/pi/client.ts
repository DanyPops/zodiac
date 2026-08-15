import type { ZodiacAgentEvent } from "@zodiac/agent";

/**
 * Driven port: the Chat surface's own view of "a live Pi agent to talk to,"
 * independent of HTTP/SSE. `createHttpPiClient` is its only adapter today,
 * talking to a real standalone zodiacd instance's /api/agent/sessions
 * routes (zodiacd stage 4) -- the browser never spawns or manages a `pi`
 * process itself, and no longer talks to a dev-server-only bridge either.
 */
export interface PiClientCreateSessionOptions {
	/** The agent session's working directory -- lets a caller bind one session to a specific Workspace's project root. Omitted keeps zodiacd's own default (the daemon's own process cwd). */
	readonly cwd?: string;
}

export interface PiClient {
	createSession: (options?: PiClientCreateSessionOptions, signal?: AbortSignal) => Promise<string>;
	sendPrompt: (sessionId: string, message: string, signal?: AbortSignal) => Promise<void>;
	/** Subscribes to a session's live event stream; returns an unsubscribe function that closes the underlying connection. */
	streamEvents: (sessionId: string, onEvent: (event: ZodiacAgentEvent) => void, onError?: (error: unknown) => void) => () => void;
	abort: (sessionId: string, signal?: AbortSignal) => Promise<void>;
}

export interface CreatePiClientOptions {
	readonly fetcher?: typeof fetch;
	/** Injectable EventSource constructor, for tests -- defaults to the browser global. */
	readonly EventSourceCtor?: typeof EventSource;
	/** Base URL of the running zodiacd instance, e.g. http://127.0.0.1:4390. Defaults to same-origin (empty string) -- a caller (App.tsx's composition root) supplies the real configured value via resolveZodiacdBaseUrl(). */
	readonly baseUrl?: string;
}

function isZodiacAgentEvent(value: unknown): value is ZodiacAgentEvent {
	return typeof value === "object" && value !== null && "type" in value && value.type !== "session-exited";
}

export function createHttpPiClient(options: CreatePiClientOptions = {}): PiClient {
	const fetcher = options.fetcher ?? fetch;
	const baseUrl = options.baseUrl ?? "";

	return {
		async createSession(createOptions, signal) {
			// A request body is only ever attached when there's something to say --
			// keeps the common no-options call identical to today's plain POST,
			// both on the wire and in every existing test that asserts its exact
			// shape.
			const requestBody = createOptions?.cwd ? JSON.stringify({ cwd: createOptions.cwd }) : undefined;
			const response = await fetcher(`${baseUrl}/api/agent/sessions`, {
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
			const response = await fetcher(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/prompt`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: message }),
				signal,
			});
			if (!response.ok) throw new Error(`pi-send-prompt:${response.status}`);
		},

		async abort(sessionId, signal) {
			const response = await fetcher(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/abort`, { method: "POST", signal });
			if (!response.ok) throw new Error(`pi-abort:${response.status}`);
		},

		streamEvents(sessionId, onEvent, onError) {
			// Resolved lazily, not at createHttpPiClient() call time -- a caller
			// that only uses createSession/sendPrompt/abort (e.g. a Node-side test)
			// must never require a browser-only global to exist just to construct
			// the client.
			const EventSourceCtor = options.EventSourceCtor ?? EventSource;
			const source = new EventSourceCtor(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/events`);
			source.onmessage = (message) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(message.data as string);
				} catch {
					return; // malformed frame, skip
				}
				// zodiacd's own SSE stream also carries a "session-exited" frame
				// (the underlying agent process/session ending on its own) -- not
				// part of ZodiacAgentEvent's own bounded vocabulary, so it's
				// filtered here rather than forwarded as one.
				if (isZodiacAgentEvent(parsed)) onEvent(parsed);
			};
			source.onerror = (event) => {
				onError?.(event);
			};
			return () => source.close();
		},
	};
}
