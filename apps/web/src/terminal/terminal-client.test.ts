import { describe, expect, it, vi } from "vitest";
import { createHttpTerminalClient } from "./terminal-client.js";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A minimal, controllable stand-in for the browser's WebSocket -- tests drive it via the returned instance's own dispatch helpers instead of a real network connection, the same FakeEventSource technique pi/client.test.ts already established. */
class FakeWebSocket {
	url: string;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onopen: (() => void) | null = null;
	sent: string[] = [];
	closed = false;
	static instances: FakeWebSocket[] = [];

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.closed = true;
	}
}

describe("createHttpTerminalClient", () => {
	it("createSession posts to zodiacd's /api/terminal/sessions and returns the sessionId from a successful response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpTerminalClient({ fetcher });
		await expect(client.createSession()).resolves.toBe("abc");
		expect(fetcher).toHaveBeenCalledWith("/api/terminal/sessions", { method: "POST", signal: undefined });
	});

	it("createSession posts a JSON body with cwd when given options", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpTerminalClient({ fetcher });
		await client.createSession({ cwd: "/repos/lector" });
		expect(fetcher).toHaveBeenCalledWith("/api/terminal/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: "/repos/lector" }),
			signal: undefined,
		});
	});

	it("prefixes every request with the configured baseUrl, for a zodiacd instance not on the same origin", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpTerminalClient({ fetcher, baseUrl: "http://127.0.0.1:4390" });
		await client.createSession();
		expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4390/api/terminal/sessions", { method: "POST", signal: undefined });
	});

	it("createSession rejects on a non-ok response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, {}));
		const client = createHttpTerminalClient({ fetcher });
		await expect(client.createSession()).rejects.toThrow("terminal-create-session:500");
	});

	it("createSession rejects when the response has no sessionId string", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		const client = createHttpTerminalClient({ fetcher });
		await expect(client.createSession()).rejects.toThrow("missing sessionId");
	});

	it("connect opens a WebSocket at ws://.../api/terminal/sessions/:id -- http(s) translated to ws(s), not left as-is", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket, baseUrl: "http://127.0.0.1:4390" });
		client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(FakeWebSocket.instances[0]?.url).toBe("ws://127.0.0.1:4390/api/terminal/sessions/sess-1");
	});

	it("connect translates https to wss", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket, baseUrl: "https://zodiac.example" });
		client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		expect(FakeWebSocket.instances[0]?.url).toBe("wss://zodiac.example/api/terminal/sessions/sess-1");
	});

	it("sendInput sends a {type: input} frame; resize sends a {type: resize} frame, once the socket is open", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		const connection = client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		FakeWebSocket.instances[0]?.onopen?.();
		connection.sendInput("ls\n");
		connection.resize(120, 40);
		expect(FakeWebSocket.instances[0]?.sent).toEqual([JSON.stringify({ type: "input", data: "ls\n" }), JSON.stringify({ type: "resize", cols: 120, rows: 40 })]);
	});

	it("close closes the underlying socket", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		const connection = client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		connection.close();
		expect(FakeWebSocket.instances[0]?.closed).toBe(true);
	});

	it("an incoming {type: output} message calls onOutput with its data", () => {
		FakeWebSocket.instances = [];
		const onOutput = vi.fn();
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		client.connect("sess-1", { onOutput, onExit: vi.fn() });
		FakeWebSocket.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "output", data: "hello" }) });
		expect(onOutput).toHaveBeenCalledWith("hello");
	});

	it("an incoming {type: exit} message calls onExit with its exitCode", () => {
		FakeWebSocket.instances = [];
		const onExit = vi.fn();
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		client.connect("sess-1", { onOutput: vi.fn(), onExit });
		FakeWebSocket.instances[0]?.onmessage?.({ data: JSON.stringify({ type: "exit", exitCode: 1 }) });
		expect(onExit).toHaveBeenCalledWith(1);
	});

	it("a malformed message is ignored, not thrown", () => {
		FakeWebSocket.instances = [];
		const onOutput = vi.fn();
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		client.connect("sess-1", { onOutput, onExit: vi.fn() });
		expect(() => FakeWebSocket.instances[0]?.onmessage?.({ data: "not json" })).not.toThrow();
		expect(onOutput).not.toHaveBeenCalled();
	});

	it("sendInput/resize called before the socket finishes connecting are queued, not sent immediately (a real WebSocket throws InvalidStateError on send() while CONNECTING)", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		const connection = client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		// The real bug this guards against: calling resize() synchronously right
		// after connect() returns, before any "open" event -- reproduced directly
		// in a live browser (zodiacd terminal surface stage 2's own empirical
		// verification), not a hypothetical.
		connection.resize(80, 24);
		expect(FakeWebSocket.instances[0]?.sent).toEqual([]);

		FakeWebSocket.instances[0]?.onopen?.();
		expect(FakeWebSocket.instances[0]?.sent).toEqual([JSON.stringify({ type: "resize", cols: 80, rows: 24 })]);
	});

	it("sendInput/resize called after the socket is already open send immediately, not queued", () => {
		FakeWebSocket.instances = [];
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		const connection = client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn() });
		FakeWebSocket.instances[0]?.onopen?.();

		connection.sendInput("ls\n");
		expect(FakeWebSocket.instances[0]?.sent).toEqual([JSON.stringify({ type: "input", data: "ls\n" })]);
	});

	it("a socket error calls onError when provided", () => {
		FakeWebSocket.instances = [];
		const onError = vi.fn();
		const client = createHttpTerminalClient({ WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket });
		client.connect("sess-1", { onOutput: vi.fn(), onExit: vi.fn(), onError });
		const errorEvent = { message: "boom" };
		FakeWebSocket.instances[0]?.onerror?.(errorEvent);
		expect(onError).toHaveBeenCalledWith(errorEvent);
	});
});
