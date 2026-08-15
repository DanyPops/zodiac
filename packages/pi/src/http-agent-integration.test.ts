import { describe, expect, it, vi } from "vitest";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { createHttpAgentIntegration, createRemoteZodiacAgentSession } from "./http-agent-integration.js";

/**
 * A fake zodiacd, real enough to exercise the agent-session routes this
 * adapter actually calls: POST /api/agent/sessions (create), POST
 * .../prompt|steer|followUp|abort (actions), and GET .../events (a real,
 * test-controlled SSE ReadableStream) -- the same shape
 * remote-world-store.test.ts already established for the World half of
 * this same daemon.
 */
function createFakeDaemon() {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posts: { action: string; body: unknown }[] = [];
	let eventsResponseStatus = 200;

	function push(event: ZodiacAgentEvent | { type: "session-exited"; reason?: string }): void {
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
	}
	function endStream(): void {
		controller?.close();
		controller = undefined;
	}

	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/agent/sessions") && init?.method === "POST") {
			return new Response(JSON.stringify({ sessionId: "sess-1" }), { status: 200 });
		}
		if (url.endsWith("/events")) {
			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
				},
			});
			return new Response(eventsResponseStatus === 200 ? stream : null, { status: eventsResponseStatus });
		}
		const match = /\/api\/agent\/sessions\/([^/]+)\/([a-zA-Z]+)$/.exec(url);
		if (match) {
			posts.push({ action: match[2]!, body: init?.body ? JSON.parse(String(init.body)) : undefined });
			return new Response(JSON.stringify({ accepted: true }), { status: 200 });
		}
		throw new Error(`fake daemon: unhandled request ${url}`);
	});

	return { fetcher, push, endStream, posts, setEventsResponseStatus: (status: number) => (eventsResponseStatus = status) };
}

describe("createHttpAgentIntegration", () => {
	it("prompt/steer/followUp POST {text} to their own action route", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		await integration.prompt("hello");
		await integration.steer("steer this");
		await integration.followUp("later");
		expect(daemon.posts).toEqual([
			{ action: "prompt", body: { text: "hello" } },
			{ action: "steer", body: { text: "steer this" } },
			{ action: "followUp", body: { text: "later" } },
		]);
		integration.dispose();
	});

	it("abort() POSTs with no body", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		await integration.abort();
		expect(daemon.posts).toEqual([{ action: "abort", body: undefined }]);
		integration.dispose();
	});

	it("forwards real ZodiacAgentEvent frames to onEvent listeners", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		const events: ZodiacAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));
		daemon.push({ type: "agent-start" });
		daemon.push({ type: "assistant-message-delta", text: "hi" });
		await vi.waitFor(() => expect(events).toHaveLength(2));
		expect(events).toEqual([{ type: "agent-start" }, { type: "assistant-message-delta", text: "hi" }]);
		integration.dispose();
	});

	it("fires onExit -- not onEvent -- for a session-exited frame", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		const events: ZodiacAgentEvent[] = [];
		const exits: (string | undefined)[] = [];
		integration.onEvent((event) => events.push(event));
		integration.onExit((reason) => exits.push(reason));
		daemon.push({ type: "session-exited", reason: "the pi process exited" });
		await vi.waitFor(() => expect(exits).toEqual(["the pi process exited"]));
		expect(events).toEqual([]);
		integration.dispose();
	});

	it("fires onExit if the stream ends without ever sending a session-exited frame (e.g. the daemon died)", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		const exits: (string | undefined)[] = [];
		integration.onExit((reason) => exits.push(reason));
		daemon.endStream();
		await vi.waitFor(() => expect(exits).toHaveLength(1));
		expect(exits[0]).toMatch(/unexpectedly/);
		integration.dispose();
	});

	it("fires onExit if GET .../events itself fails (e.g. the session was never created)", async () => {
		const daemon = createFakeDaemon();
		daemon.setEventsResponseStatus(404);
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "missing", fetcher: daemon.fetcher });
		const exits: (string | undefined)[] = [];
		integration.onExit((reason) => exits.push(reason));
		await vi.waitFor(() => expect(exits).toHaveLength(1));
		expect(exits[0]).toMatch(/404/);
		integration.dispose();
	});

	it("dispose() stops delivering further events -- no reconnect attempt (unlike World's remote store)", async () => {
		const daemon = createFakeDaemon();
		const integration = createHttpAgentIntegration({ baseUrl: "http://fake", sessionId: "sess-1", fetcher: daemon.fetcher });
		const events: ZodiacAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));
		integration.dispose();
		daemon.push({ type: "agent-start" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(events).toEqual([]);
	});
});

describe("createRemoteZodiacAgentSession", () => {
	it("creates a session via POST /api/agent/sessions and returns an integration already wired to it", async () => {
		const daemon = createFakeDaemon();
		const { sessionId, integration } = await createRemoteZodiacAgentSession({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		expect(sessionId).toBe("sess-1");
		await integration.prompt("hi");
		expect(daemon.posts).toEqual([{ action: "prompt", body: { text: "hi" } }]);
		integration.dispose();
	});

	it("sends cwd in the request body only when given", async () => {
		const daemon = createFakeDaemon();
		await createRemoteZodiacAgentSession({ baseUrl: "http://fake", cwd: "/repos/lector", fetcher: daemon.fetcher });
		expect(daemon.fetcher).toHaveBeenCalledWith("http://fake/api/agent/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: "/repos/lector" }),
		});
	});

	it("rejects with a clear error if session creation fails", async () => {
		const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
		await expect(createRemoteZodiacAgentSession({ baseUrl: "http://fake", fetcher: fetcher as unknown as typeof fetch })).rejects.toThrow(/500/);
	});
});
