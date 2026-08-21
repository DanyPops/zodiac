import { describe, expect, it, vi } from "vitest";
import { createHttpPiClient } from "./client.js";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A minimal, controllable stand-in for the browser's EventSource -- tests drive it by calling the returned `dispatch`/`fail` helpers instead of a real network connection. */
class FakeEventSource {
	url: string;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	closed = false;
	static instances: FakeEventSource[] = [];

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	close(): void {
		this.closed = true;
	}
}

describe("createHttpPiClient", () => {
	it("createSession posts to zodiacd's /api/agent/sessions and returns the sessionId from a successful response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpPiClient({ fetcher });
		await expect(client.createSession()).resolves.toBe("abc");
		expect(fetcher).toHaveBeenCalledWith("/api/agent/sessions", { method: "POST", signal: undefined });
	});

	it("createSession posts a JSON body with cwd when given options, unlike the plain no-options call", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpPiClient({ fetcher });
		await expect(client.createSession({ cwd: "/repos/lector" })).resolves.toBe("abc");
		expect(fetcher).toHaveBeenCalledWith("/api/agent/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ cwd: "/repos/lector" }),
			signal: undefined,
		});
	});

	it("prefixes every request with the configured baseUrl, for a zodiacd instance not on the same origin", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpPiClient({ fetcher, baseUrl: "http://127.0.0.1:4390" });
		await client.createSession();
		expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4390/api/agent/sessions", { method: "POST", signal: undefined });
	});

	it("createSession rejects on a non-ok response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, {}));
		const client = createHttpPiClient({ fetcher });
		await expect(client.createSession()).rejects.toThrow("pi-create-session:500");
	});

	it("createSession rejects when the response has no sessionId string", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		const client = createHttpPiClient({ fetcher });
		await expect(client.createSession()).rejects.toThrow("pi-create-session:invalid-response");
	});

	it("sendPrompt posts the text as JSON to the session's own prompt endpoint", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true }));
		const client = createHttpPiClient({ fetcher });
		await client.sendPrompt("s1", "hello");
		expect(fetcher).toHaveBeenCalledWith("/api/agent/sessions/s1/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: "hello" }),
			signal: undefined,
		});
	});

	it("sendPrompt rejects on a non-ok response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(404, {}));
		const client = createHttpPiClient({ fetcher });
		await expect(client.sendPrompt("s1", "hi")).rejects.toThrow("pi-send-prompt:404");
	});

	it("abort posts to the session's own abort endpoint", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true }));
		const client = createHttpPiClient({ fetcher });
		await client.abort("s1");
		expect(fetcher).toHaveBeenCalledWith("/api/agent/sessions/s1/abort", { method: "POST", signal: undefined });
	});

	it("forwards model, compaction, resume, and fork controls to their session routes", async () => {
		const fetcher = vi.fn(async (input: string | URL | Request) => {
			void input;
			return jsonResponse(200, { ok: true });
		});
		const client = createHttpPiClient({ fetcher });
		await client.setModel!("s1", "anthropic", "sonnet");
		await client.compact!("s1", "focus");
		await client.resume!("s1", "/tmp/session.jsonl");
		await client.fork!("s1", "entry-1");
		expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
			"/api/agent/sessions/s1/setModel",
			"/api/agent/sessions/s1/compact",
			"/api/agent/sessions/s1/resume",
			"/api/agent/sessions/s1/fork",
		]);
	});

	it("streamEvents connects to the session's own events endpoint, parses each SSE frame into a ZodiacAgentEvent, and forwards it", () => {
		FakeEventSource.instances = [];
		const client = createHttpPiClient({ EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const received: unknown[] = [];
		client.streamEvents("s1", (event) => received.push(event));

		const source = FakeEventSource.instances[0]!;
		expect(source.url).toBe("/api/agent/sessions/s1/events");
		source.onmessage?.({ data: '{"type":"agent-start"}' });
		source.onmessage?.({ data: "not json" });

		expect(received).toEqual([{ type: "agent-start" }]);
	});

	it("streamEvents filters out zodiacd's own session-exited frame -- not part of ZodiacAgentEvent's bounded vocabulary", () => {
		FakeEventSource.instances = [];
		const client = createHttpPiClient({ EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const received: unknown[] = [];
		client.streamEvents("s1", (event) => received.push(event));

		const source = FakeEventSource.instances[0]!;
		source.onmessage?.({ data: '{"type":"session-exited","reason":"process exited"}' });
		source.onmessage?.({ data: '{"type":"agent-settled"}' });

		expect(received).toEqual([{ type: "agent-settled" }]);
	});

	it("streamEvents forwards connection errors to onError", () => {
		FakeEventSource.instances = [];
		const client = createHttpPiClient({ EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const onError = vi.fn();
		client.streamEvents("s1", () => {}, onError);

		const source = FakeEventSource.instances[0]!;
		const errorEvent = { type: "error" };
		source.onerror?.(errorEvent);
		expect(onError).toHaveBeenCalledWith(errorEvent);
	});

	it("streamEvents's returned unsubscribe closes the EventSource", () => {
		FakeEventSource.instances = [];
		const client = createHttpPiClient({ EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const unsubscribe = client.streamEvents("s1", () => {});
		unsubscribe();
		expect(FakeEventSource.instances[0]!.closed).toBe(true);
	});

	it("postClientAction POSTs the given result to the session's own client-actions route, keyed by toolCallId", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { delivered: true }));
		const client = createHttpPiClient({ fetcher });
		await client.postClientAction("s1", "call-1", { cues: [{ id: "a" }] });
		expect(fetcher).toHaveBeenCalledWith("/api/agent/sessions/s1/client-actions/call-1", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ result: { cues: [{ id: "a" }] } }),
			signal: undefined,
		});
	});

	it("postClientAction throws on a genuine transport failure", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(500, { code: "internal" }));
		const client = createHttpPiClient({ fetcher });
		await expect(client.postClientAction("s1", "call-1", {})).rejects.toThrow(/pi-post-client-action/);
	});
});
