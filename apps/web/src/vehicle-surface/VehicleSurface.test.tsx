/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VehicleSurfaceClient } from "./client.js";
import { VehicleSurfaceContent } from "./VehicleSurface.js";

const manifest = {
	id: "papyrus", title: "Papyrus", vehicle: { name: "papyrus", version: "1", description: "Graph artifacts" },
	operations: [
		{ name: "tasks.list", version: 1, description: "List tasks", effect: "read" as const, available: true, approvalRequired: false, permissions: ["tasks:read"], limits: { defaultTimeoutMs: 1000, maxTimeoutMs: 5000, maxRequestBytes: 1024, maxResponseBytes: 4096 } },
		{ name: "tasks.start", version: 1, description: "Start task", effect: "local-write" as const, available: true, approvalRequired: false, permissions: ["tasks:write"], limits: { defaultTimeoutMs: 1000, maxTimeoutMs: 5000, maxRequestBytes: 1024, maxResponseBytes: 4096 } },
	], events: [{ name: "tasks.changed", version: 1, description: "Changed", maxPayloadBytes: 4096 }],
};

function clientFixture() {
	let listener: ((event: { type: "event"; surfaceId: string; topic: string; payload: unknown } | { type: "state"; surfaceId: string; state: "connecting" | "live" | "degraded" | "closed" }) => void) | undefined;
	let rows = [{ id: "task-1", title: "First task", status: "todo" }];
	const invoke = vi.fn(async (_surfaceId, request: { name: string }) => request.name === "tasks.list" ? { ok: true as const, output: rows } : { ok: true as const, output: { changed: true } });
	const client: VehicleSurfaceClient = {
		manifest: vi.fn(async () => manifest),
		invoke,
		subscribe: (_surfaceId, next) => { listener = next; return { close: vi.fn() }; },
	};
	return { client, invoke, emit: (event: Parameters<NonNullable<typeof listener>>[0]) => listener?.(event), setRows: (next: typeof rows) => { rows = next; } };
}

afterEach(cleanup);

describe("VehicleSurfaceContent", () => {
	it("renders Papyrus manifest operations and task lifecycle without exposing credentials", async () => {
		const fixture = clientFixture();
		const { container } = render(<VehicleSurfaceContent surfaceId="papyrus" client={fixture.client} />);
		await screen.findByText("Graph artifacts");
		fireEvent.change(screen.getByLabelText("Project root"), { target: { value: "/repo" } });
		fireEvent.click(screen.getByRole("button", { name: "Refresh Tasks" }));
		await screen.findByText("First task");
		fireEvent.click(screen.getByRole("button", { name: "Start First task" }));
		await waitFor(() => expect(fixture.invoke).toHaveBeenCalledWith("papyrus", expect.objectContaining({ name: "tasks.start", input: { id: "task-1", project_root: "/repo" } })));
		expect(container.textContent).not.toMatch(/bearer|token|authorization/i);
	});

	it("refreshes the active view from push invalidation instead of polling", async () => {
		const fixture = clientFixture();
		render(<VehicleSurfaceContent surfaceId="papyrus" client={fixture.client} />);
		await screen.findByText("Graph artifacts");
		fireEvent.change(screen.getByLabelText("Project root"), { target: { value: "/repo" } });
		fireEvent.click(screen.getByRole("button", { name: "Refresh Tasks" }));
		await screen.findByText("First task");
		fixture.setRows([{ id: "task-2", title: "Live update", status: "in-progress" }]);
		await act(async () => fixture.emit({ type: "event", surfaceId: "papyrus", topic: "vehicle-event:tasks.changed@1", payload: {} }));
		await screen.findByText("Live update");
		expect(fixture.invoke.mock.calls.filter(([, request]) => request.name === "tasks.list")).toHaveLength(2);
	});
});
