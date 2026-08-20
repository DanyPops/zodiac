import { describe, expect, it, vi } from "vitest";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { connectRemoteNotifications } from "./remote-notifications.js";

function makeRequest(overrides: Partial<VehicleApprovalRequest> = {}): VehicleApprovalRequest {
	return {
		requestId: "REQ-1",
		operationName: "issue.create",
		operationVersion: 1,
		effect: "external-write",
		requestedAt: Date.now(),
		expiresAt: Date.now() + 5 * 60_000,
		inputHash: "deadbeef",
		...overrides,
	};
}

/** Same shape as @zodiac/world's own fake daemon -- real enough to exercise connectRemoteNotifications' own three routes without a live process. */
function createFakeDaemon(initialPending: readonly VehicleApprovalRequest[] = []) {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posted: string[] = [];

	function push(frame: unknown): void {
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
	}

	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/notifications") && (!init || init.method === undefined)) {
			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
					c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "notifications.snapshot", pending: initialPending })}\n\n`));
				},
			});
			return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
		}
		if (/\/api\/notifications\/.+\/(approve|deny)$/.test(url) && init?.method === "POST") {
			posted.push(url);
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}
		throw new Error(`fake daemon: unhandled request ${url}`);
	});

	return { fetcher, push, posted };
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("connectRemoteNotifications", () => {
	it("starts empty, then reflects the initial snapshot frame once the stream connects", async () => {
		const request = makeRequest();
		const daemon = createFakeDaemon([request]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });

		expect(client.pending()).toEqual([]);
		await flush();
		expect(client.pending()).toEqual([request]);
		client.dispose();
	});

	it("adds a newly published vehicle.approval.requested notification and notifies onChange", async () => {
		const daemon = createFakeDaemon([]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		await flush();
		const seen: (readonly VehicleApprovalRequest[])[] = [];
		client.onChange((pending) => seen.push(pending));

		const request = makeRequest({ requestId: "REQ-2" });
		daemon.push({ type: "vehicle.approval.requested", payload: request });
		await flush();

		expect(client.pending()).toEqual([request]);
		expect(seen).toContainEqual([request]);
		client.dispose();
	});

	it("removes a request from pending once its vehicle.approval.resolved outcome arrives", async () => {
		const daemon = createFakeDaemon([makeRequest()]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		await flush();
		expect(client.pending()).toHaveLength(1);

		daemon.push({ type: "vehicle.approval.resolved", payload: { requestId: "REQ-1" } });
		await flush();
		expect(client.pending()).toEqual([]);
		client.dispose();
	});

	it("approve() POSTs to the request's own approve endpoint", async () => {
		const daemon = createFakeDaemon([]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		await flush();

		client.approve("REQ-1");
		await flush();
		expect(daemon.posted).toEqual(["http://fake/api/notifications/REQ-1/approve"]);
		client.dispose();
	});

	it("deny() POSTs to the request's own deny endpoint", async () => {
		const daemon = createFakeDaemon([]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		await flush();

		client.deny("REQ-1");
		await flush();
		expect(daemon.posted).toEqual(["http://fake/api/notifications/REQ-1/deny"]);
		client.dispose();
	});

	it("dispose() stops delivering further onChange notifications", async () => {
		const daemon = createFakeDaemon([]);
		const client = connectRemoteNotifications({ baseUrl: "http://fake", fetcher: daemon.fetcher });
		await flush();
		const seen: unknown[] = [];
		client.onChange((pending) => seen.push(pending));
		client.dispose();

		daemon.push({ type: "vehicle.approval.requested", payload: makeRequest() });
		await flush();
		expect(seen).toEqual([]);
	});
});
