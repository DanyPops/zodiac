/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { useNotifications } from "./use-notifications.js";

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

/** Same shape as use-world-client.test.ts's own fake daemon -- real enough to exercise the /api/notifications SSE stream and approve/deny POSTs without a live process. */
function createFakeDaemon(initialPending: readonly VehicleApprovalRequest[] = []) {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();
	const posted: { url: string }[] = [];

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
			posted.push({ url });
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}
		throw new Error(`fake daemon: unhandled request ${url}`);
	});

	return { fetcher, push, posted };
}

describe("useNotifications", () => {
	it("starts empty, then reflects the initial snapshot frame once connected", async () => {
		const request = makeRequest();
		const daemon = createFakeDaemon([request]);
		const { result } = renderHook(() => useNotifications("http://fake", { fetcher: daemon.fetcher }));

		expect(result.current.pending).toEqual([]);
		await waitFor(() => expect(result.current.pending).toEqual([request]));
	});

	it("adds a newly published vehicle.approval.requested notification to pending", async () => {
		const daemon = createFakeDaemon([]);
		const { result } = renderHook(() => useNotifications("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(daemon.fetcher).toHaveBeenCalled());

		const request = makeRequest({ requestId: "REQ-2" });
		daemon.push({ type: "vehicle.approval.requested", payload: request });
		await waitFor(() => expect(result.current.pending).toEqual([request]));
	});

	it("removes a request from pending once its vehicle.approval.resolved outcome arrives", async () => {
		const daemon = createFakeDaemon([makeRequest()]);
		const { result } = renderHook(() => useNotifications("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(result.current.pending).toHaveLength(1));

		daemon.push({ type: "vehicle.approval.resolved", payload: { requestId: "REQ-1" } });
		await waitFor(() => expect(result.current.pending).toEqual([]));
	});

	it("approve() POSTs to the request's own approve endpoint", async () => {
		const daemon = createFakeDaemon([]);
		const { result } = renderHook(() => useNotifications("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(daemon.fetcher).toHaveBeenCalled());

		result.current.approve("REQ-1");
		await waitFor(() => expect(daemon.posted).toEqual([{ url: "http://fake/api/notifications/REQ-1/approve" }]));
	});

	it("deny() POSTs to the request's own deny endpoint", async () => {
		const daemon = createFakeDaemon([]);
		const { result } = renderHook(() => useNotifications("http://fake", { fetcher: daemon.fetcher }));
		await waitFor(() => expect(daemon.fetcher).toHaveBeenCalled());

		result.current.deny("REQ-1");
		await waitFor(() => expect(daemon.posted).toEqual([{ url: "http://fake/api/notifications/REQ-1/deny" }]));
	});
});
