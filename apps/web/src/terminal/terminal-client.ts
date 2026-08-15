/**
 * Driven port: the Terminal surface's own view of "a live shell to attach
 * to," independent of HTTP/WebSocket. `createHttpTerminalClient` is its
 * only adapter, talking to a real standalone zodiacd instance's
 * /api/terminal/sessions routes (zodiacd's terminal surface stage 1) -- the
 * browser never spawns a shell itself, node-pty can't run there at all.
 *
 * One WebSocket per session carries both directions, mirroring VS Code's
 * own RemoteTerminalChannelClient (see the "zodiacd API surface" Papyrus
 * Doc's Terminal sessions section) rather than PiClient's SSE-only shape --
 * the one deliberate transport difference from every other zodiacd client
 * in this codebase, for the same reason zodiacd itself carries it as its
 * one scoped exception.
 */
export interface TerminalCreateSessionOptions {
	/** The new session's own working directory -- lets a caller bind one terminal to a specific Workspace's project root. Omitted keeps zodiacd's own default (the daemon's own cwd). */
	readonly cwd?: string;
}

export interface TerminalConnectionHandlers {
	onOutput: (data: string) => void;
	/** The shell exited on its own; the connection itself is left open (a client decides for itself when it's done watching). */
	onExit: (exitCode: number) => void;
	onError?: (error: unknown) => void;
}

export interface TerminalConnection {
	sendInput: (data: string) => void;
	resize: (cols: number, rows: number) => void;
	close: () => void;
}

export interface TerminalClient {
	createSession: (options?: TerminalCreateSessionOptions, signal?: AbortSignal) => Promise<string>;
	/** Opens the one WebSocket for this session -- attaching to an already-live shell (e.g. a second panel on the same sessionId) works identically to attaching right after creation. */
	connect: (sessionId: string, handlers: TerminalConnectionHandlers) => TerminalConnection;
}

export interface CreateTerminalClientOptions {
	readonly fetcher?: typeof fetch;
	/** Injectable WebSocket constructor, for tests -- defaults to the browser global. */
	readonly WebSocketCtor?: typeof WebSocket;
	/** Base URL of the running zodiacd instance, e.g. http://127.0.0.1:4390. Defaults to same-origin (empty string). */
	readonly baseUrl?: string;
}

/** http(s) -> ws(s), same origin/host/port -- a WebSocket URL is not resolved against the page's own scheme automatically the way a plain fetch path is. */
function toWebSocketUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/^https/, "wss").replace(/^http/, "ws")}${path}`;
}

export function createHttpTerminalClient(options: CreateTerminalClientOptions = {}): TerminalClient {
	const fetcher = options.fetcher ?? fetch;
	const WebSocketCtor = options.WebSocketCtor ?? WebSocket;
	const baseUrl = options.baseUrl ?? "";

	return {
		async createSession(createOptions, signal) {
			// A request body is only ever attached when there's something to say
			// -- same convention PiClient's own createSession already established.
			const requestBody = createOptions?.cwd ? JSON.stringify({ cwd: createOptions.cwd }) : undefined;
			const response = await fetcher(`${baseUrl}/api/terminal/sessions`, {
				method: "POST",
				...(requestBody ? { headers: { "Content-Type": "application/json" }, body: requestBody } : {}),
				signal,
			});
			if (!response.ok) throw new Error(`terminal-create-session:${response.status}`);
			const body = (await response.json()) as { sessionId?: unknown };
			if (typeof body.sessionId !== "string") throw new Error("terminal-create-session: response missing sessionId");
			return body.sessionId;
		},

		connect(sessionId, handlers) {
			const ws = new WebSocketCtor(toWebSocketUrl(baseUrl, `/api/terminal/sessions/${sessionId}`));
			// A caller (TerminalSurfaceContent resizes to the terminal's own initial
			// size the instant connect() returns) can and does call sendInput/resize
			// before the handshake finishes -- ws.send() throws InvalidStateError
			// synchronously in that CONNECTING window, confirmed directly (a real,
			// reproduced "Terminal connection error" in a live browser, not a
			// hypothetical). Queueing until onopen, rather than requiring every
			// caller to wait for a callback first, is the same fix real WebSocket
			// client libraries (e.g. reconnecting-websocket) use for this exact race.
			let open = false;
			const pending: string[] = [];
			function sendFrame(frame: string): void {
				if (open) ws.send(frame);
				else pending.push(frame);
			}
			ws.onopen = () => {
				open = true;
				for (const frame of pending) ws.send(frame);
				pending.length = 0;
			};
			ws.onmessage = (event: MessageEvent) => {
				let message: unknown;
				try {
					message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
				} catch {
					return;
				}
				if (!message || typeof message !== "object") return;
				const type = (message as { type?: unknown }).type;
				if (type === "output") {
					const data = (message as { data?: unknown }).data;
					if (typeof data === "string") handlers.onOutput(data);
				} else if (type === "exit") {
					const exitCode = (message as { exitCode?: unknown }).exitCode;
					if (typeof exitCode === "number") handlers.onExit(exitCode);
				}
			};
			ws.onerror = (event: Event) => handlers.onError?.(event);
			return {
				sendInput(data) {
					sendFrame(JSON.stringify({ type: "input", data }));
				},
				resize(cols, rows) {
					sendFrame(JSON.stringify({ type: "resize", cols, rows }));
				},
				close() {
					ws.close();
				},
			};
		},
	};
}
