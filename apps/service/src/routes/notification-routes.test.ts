import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { createEventBus } from "@zodiac/server";
import { createApprovalCenter } from "@zodiac/server/approval";
import { createNotificationRoutes } from "./notification-routes.js";

let server: Server | undefined;

afterEach(() => {
	server?.close();
	server = undefined;
});

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
	return `http://127.0.0.1:${address.port}`;
}

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

describe("createNotificationRoutes", () => {
	it("streamNotifications sends the current pending list as its own first frame", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		const request = makeRequest();
		approvalCenter.request(request);
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.streamNotifications(req, res));

		const controller = new AbortController();
		const response = await fetch(`${base}/api/notifications`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();
		const { value } = await reader.read();
		const received = decoder.decode(value);
		const frame = JSON.parse(received.replace(/^data: /, "").trim()) as { type: string; pending: readonly VehicleApprovalRequest[] };
		expect(frame).toEqual({ type: "notifications.snapshot", pending: [request] });

		controller.abort();
	});

	it("streamNotifications broadcasts a newly published notification live, after the initial snapshot", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.streamNotifications(req, res));

		const controller = new AbortController();
		const response = await fetch(`${base}/api/notifications`, { signal: controller.signal });
		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();

		let received = "";
		const { value } = await reader.read();
		received += decoder.decode(value); // the empty snapshot frame

		approvalCenter.request(makeRequest());
		while (!received.includes("vehicle.approval.requested")) {
			const next = await reader.read();
			if (next.done) break;
			received += decoder.decode(next.value);
		}
		expect(received).toContain("vehicle.approval.requested");
		expect(received).toContain("REQ-1");

		controller.abort();
	});

	it("streamNotifications stops broadcasting to a disconnected client (unsubscribes on close)", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.streamNotifications(req, res));

		const controller = new AbortController();
		await fetch(`${base}/api/notifications`, { signal: controller.signal });
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(bus.listenerCount("notification", "*")).toBe(0);
	});

	it("postApprove calls ApprovalCenter.approve() and returns the minted capability", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		approvalCenter.request(makeRequest());
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.postApprove(req, res, "REQ-1"));

		const response = await fetch(`${base}/x`, { method: "POST" });
		expect(response.status).toBe(200);
		const body = (await response.json()) as { capability: string };
		expect(typeof body.capability).toBe("string");
		expect(body.capability.length).toBeGreaterThan(0);
		expect(approvalCenter.pending()).toHaveLength(0);
	});

	it("postApprove returns 404 for a requestId that isn't currently pending", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.postApprove(req, res, "GHOST"));

		const response = await fetch(`${base}/x`, { method: "POST" });
		expect(response.status).toBe(404);
	});

	it("postDeny calls ApprovalCenter.deny(), resolving the request without minting a capability", async () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		approvalCenter.request(makeRequest());
		const routes = createNotificationRoutes(bus, approvalCenter);
		const base = await listen((req, res) => routes.postDeny(req, res, "REQ-1"));

		const response = await fetch(`${base}/x`, { method: "POST" });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(approvalCenter.pending()).toHaveLength(0);
	});
});
