import { isZodiacAgentEvent, type AgentIntegrationPort, type ZodiacAgentEvent } from "@zodiac/agent";
import { readSseFrames } from "@zodiac/server/net";

export interface HttpAgentIntegrationOptions {
	/** Base URL of a running zodiacd instance, e.g. http://127.0.0.1:4390. */
	readonly baseUrl: string;
	/** An already-created agent session's id (see createRemoteZodiacAgentSession, which creates one and wires this adapter to it in one call). */
	readonly sessionId: string;
	readonly fetcher?: typeof fetch;
}

/**
 * An `AgentIntegrationPort` backed by a real, already-running zodiacd
 * instance's `/api/agent/sessions/:id` routes -- the third adapter behind
 * this port (alongside InProcessAgentIntegration and
 * SubprocessAgentIntegration), for zodiacd stage 5: apps/terminal attaching
 * to a daemon's own agent session instead of spawning/hosting one itself.
 * Wire shape mirrors apps/web's own PiClient exactly (same routes, same
 * zodiacd this whole package's other adapters otherwise never talk to
 * directly) -- see the "zodiacd API surface" Papyrus Doc.
 *
 * Deliberately does *not* auto-reconnect a dropped event stream the way
 * @zodiac/server's connectRemoteWorldStore does. That's safe for World
 * because every reconnect's first frame is the *current* full snapshot
 * (idempotent). It is *not* safe here: zodiacd's own agent-session SSE
 * route replays the session's entire accumulated history on every new
 * connection (the same "replay-then-tail" a late-joining subscriber needs),
 * so silently reconnecting would replay -- and duplicate -- everything
 * already-seen. Instead, a stream ending unexpectedly is reported through
 * `onExit`, the exact mechanism this port already defines for "the
 * underlying integration ended on its own" (originally written for a
 * subprocess exiting) -- a lost remote connection is the same kind of
 * event, and callers (footer-chat-controller.ts) already handle it
 * correctly with no changes needed.
 */
export function createHttpAgentIntegration(options: HttpAgentIntegrationOptions): AgentIntegrationPort {
	const { baseUrl, sessionId } = options;
	const fetcher = options.fetcher ?? fetch;
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	const exitListeners = new Set<(reason: string | undefined) => void>();
	const streamController = new AbortController();
	let exited = false;

	function emitExit(reason: string | undefined): void {
		if (exited) return;
		exited = true;
		for (const listener of exitListeners) listener(reason);
	}

	async function postAction(action: "prompt" | "steer" | "followUp", text: string): Promise<void> {
		const response = await fetcher(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/${action}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});
		if (!response.ok) throw new Error(`http-agent-integration:${action}:${response.status}`);
	}

	async function streamEvents(): Promise<void> {
		try {
			const response = await fetcher(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/events`, { signal: streamController.signal });
			if (!response.ok) {
				emitExit(`connection to zodiacd failed (${response.status})`);
				return;
			}
			await readSseFrames(response, (data) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(data);
				} catch {
					return; // malformed frame -- skip
				}
				if (isZodiacAgentEvent(parsed)) {
					for (const listener of eventListeners) listener(parsed);
					return;
				}
				const reason = (parsed as { reason?: unknown } | null)?.reason;
				emitExit(typeof reason === "string" ? reason : undefined);
			});
			// The stream ended without a "session-exited" frame ever arriving
			// (e.g. the daemon process itself was killed) -- still an
			// unexpected end from this adapter's own point of view.
			emitExit(streamController.signal.aborted ? undefined : "the connection to zodiacd ended unexpectedly");
		} catch (error) {
			if (streamController.signal.aborted) return; // dispose()'s own doing, not a real failure
			emitExit(error instanceof Error ? error.message : String(error));
		}
	}
	void streamEvents();

	return {
		async prompt(text) {
			await postAction("prompt", text);
		},
		async steer(text) {
			await postAction("steer", text);
		},
		async followUp(text) {
			await postAction("followUp", text);
		},
		async abort() {
			const response = await fetcher(`${baseUrl}/api/agent/sessions/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
			if (!response.ok) throw new Error(`http-agent-integration:abort:${response.status}`);
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit(listener) {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		dispose() {
			streamController.abort();
			eventListeners.clear();
			exitListeners.clear();
		},
	};
}

export interface CreateRemoteZodiacAgentSessionOptions {
	readonly baseUrl: string;
	/** The agent session's working directory. Omitted keeps zodiacd's own default (the daemon's own process cwd). */
	readonly cwd?: string;
	readonly fetcher?: typeof fetch;
}

export interface RemoteZodiacAgentSession {
	readonly sessionId: string;
	readonly integration: AgentIntegrationPort;
}

/**
 * Creates a brand-new agent session on a real, already-running zodiacd
 * instance (POST /api/agent/sessions) and returns it already wrapped in
 * createHttpAgentIntegration -- the remote counterpart to
 * createZodiacAgentSession (which always constructs a real in-process
 * AgentSession). apps/terminal's own startFooterChat picks between the two
 * based on whether a daemon URL was configured; neither
 * FooterChatController nor anything else downstream of AgentIntegrationPort
 * needs to know which one it got.
 */
export async function createRemoteZodiacAgentSession(options: CreateRemoteZodiacAgentSessionOptions): Promise<RemoteZodiacAgentSession> {
	const fetcher = options.fetcher ?? fetch;
	const response = await fetcher(`${options.baseUrl}/api/agent/sessions`, {
		method: "POST",
		...(options.cwd ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: options.cwd }) } : {}),
	});
	if (!response.ok) throw new Error(`createRemoteZodiacAgentSession: POST /api/agent/sessions returned ${response.status}`);
	const body = (await response.json()) as { sessionId?: unknown };
	if (typeof body.sessionId !== "string") throw new Error("createRemoteZodiacAgentSession: invalid response (no sessionId)");
	return { sessionId: body.sessionId, integration: createHttpAgentIntegration({ baseUrl: options.baseUrl, sessionId: body.sessionId, fetcher }) };
}
