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
	it("createSession posts and returns the sessionId from a successful response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "abc" }));
		const client = createHttpPiClient({ fetcher });
		await expect(client.createSession()).resolves.toBe("abc");
		expect(fetcher).toHaveBeenCalledWith("/api/pi/sessions", { method: "POST", signal: undefined });
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

	it("sendPrompt posts the message as JSON to the session's prompt endpoint", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true }));
		const client = createHttpPiClient({ fetcher });
		await client.sendPrompt("s1", "hello");
		expect(fetcher).toHaveBeenCalledWith("/api/pi/prompt?sessionId=s1", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "hello" }),
			signal: undefined,
		});
	});

	it("sendPrompt rejects on a non-ok response", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(404, {}));
		const client = createHttpPiClient({ fetcher });
		await expect(client.sendPrompt("s1", "hi")).rejects.toThrow("pi-send-prompt:404");
	});

	it("abort posts to the session's abort endpoint", async () => {
		const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, { accepted: true }));
		const client = createHttpPiClient({ fetcher });
		await client.abort("s1");
		expect(fetcher).toHaveBeenCalledWith("/api/pi/abort?sessionId=s1", { method: "POST", signal: undefined });
	});

	it("streamEvents parses each SSE message into a PiRpcEvent and forwards it", () => {
		FakeEventSource.instances = [];
		const client = createHttpPiClient({ EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const received: unknown[] = [];
		client.streamEvents("s1", (event) => received.push(event));

		const source = FakeEventSource.instances[0]!;
		expect(source.url).toBe("/api/pi/events?sessionId=s1");
		source.onmessage?.({ data: '{"type":"agent_start"}' });
		source.onmessage?.({ data: "not json" });

		expect(received).toEqual([{ type: "agent_start" }]);
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
});
