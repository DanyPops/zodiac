import { describe, expect, it, vi } from "vitest";
import { createHttpVehicleSurfaceClient } from "./client.js";

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	readonly listeners = new Map<string, (event: MessageEvent) => void>();
	closed = false;
	constructor(readonly url: string) { FakeEventSource.instances.push(this); }
	addEventListener(type: string, listener: EventListener): void { this.listeners.set(type, listener as (event: MessageEvent) => void); }
	close(): void { this.closed = true; }
	emit(type: string, data: unknown): void { this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent); }
}

const manifest = { id: "papyrus", title: "Papyrus", vehicle: { name: "papyrus", version: "1", description: "Graph" }, operations: [], events: [] };

describe("HttpVehicleSurfaceClient", () => {
	it("loads and invokes through zodiacd routes without an authorization header", async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			void init;
			return new Response(JSON.stringify(String(input).endsWith("/manifest") ? manifest : { ok: true, output: [] }), { status: 200, headers: { "content-type": "application/json" } });
		});
		const client = createHttpVehicleSurfaceClient({ baseUrl: "http://127.0.0.1:4390", fetcher, EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		expect(await client.manifest("papyrus")).toEqual(manifest);
		expect(await client.invoke("papyrus", { name: "tasks.list", version: 1, input: {} })).toEqual({ ok: true, output: [] });
		for (const [, init] of fetcher.mock.calls) expect(new Headers(init?.headers).has("authorization")).toBe(false);
	});

	it("validates malformed daemon payloads", async () => {
		const client = createHttpVehicleSurfaceClient({ baseUrl: "http://fake", fetcher: async () => new Response(JSON.stringify({ operations: "bad" })), EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		await expect(client.manifest("papyrus")).rejects.toThrow(/invalid Vehicle Surface manifest/i);
	});

	it("parses live events and closes EventSource on disposal", () => {
		FakeEventSource.instances = [];
		const client = createHttpVehicleSurfaceClient({ baseUrl: "http://127.0.0.1:4390", fetcher: vi.fn(), EventSourceCtor: FakeEventSource as unknown as typeof EventSource });
		const listener = vi.fn();
		const subscription = client.subscribe("papyrus", listener);
		const source = FakeEventSource.instances[0];
		expect(source?.url).toBe("http://127.0.0.1:4390/api/vehicle-surfaces/papyrus/events");
		source?.emit("vehicle-surface", { type: "state", surfaceId: "papyrus", state: "live" });
		expect(listener).toHaveBeenCalledWith({ type: "state", surfaceId: "papyrus", state: "live" });
		source?.emit("vehicle-surface", { type: "state", surfaceId: "papyrus", state: "not-real" });
		expect(listener).toHaveBeenCalledTimes(1);
		subscription.close();
		expect(source?.closed).toBe(true);
	});
});
