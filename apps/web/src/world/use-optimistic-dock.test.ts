/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { integrationId, workspaceId } from "@zodiac/protocol";
import type { WorldViewModel } from "@zodiac/protocol";
import { useOptimisticDock, type UseOptimisticDockResult } from "./use-optimistic-dock.js";

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function readyWithSurfaces(surfaces: readonly { id: string; integrationId: string; title: string }[]): WorldViewModel {
	return {
		state: "ready",
		activeWorkspaceId: workspaceId("ws"),
		workspaces: [
			{
				id: workspaceId("ws"),
				title: "WS",
				activeWindowId: "window-1",
				windows: [{ id: "window-1", title: "Window 0", active: true, surfaces: surfaces.map((surface) => ({ ...surface, status: "idle", selected: false })) }],
			},
		],
	} as unknown as WorldViewModel;
}

function fetcherReturning(status: number, body: unknown): typeof fetch {
	return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("useOptimisticDock", () => {
	it("renders a pending placeholder immediately, before the POST resolves", async () => {
		let resolvePost!: (value: Response) => void;
		const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolvePost = resolve; })) as unknown as typeof fetch;
		const { result, rerender } = renderHook<UseOptimisticDockResult, { viewModel: WorldViewModel }>(({ viewModel }) => useOptimisticDock("http://fake", viewModel, fetcher), { initialProps: { viewModel: EMPTY } });

		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity" }));

		expect(result.current.pending).toHaveLength(1);
		expect(result.current.pending[0]?.title).toBe("Activity");

		resolvePost(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
		rerender({ viewModel: EMPTY });
		await waitFor(() => expect(fetcher).toHaveBeenCalled());
	});

	it("rolls the optimistic placeholder back and surfaces a real error when the daemon rejects the command (collision)", async () => {
		const fetcher = fetcherReturning(400, { code: "command-failed", message: "Cannot dock into Window: surface-id-collision" });
		const { result } = renderHook(() => useOptimisticDock("http://fake", EMPTY, fetcher));

		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity" }));
		expect(result.current.pending).toHaveLength(1);

		await waitFor(() => expect(result.current.pending).toHaveLength(0));
		expect(result.current.lastError).toBe("Cannot dock into Window: surface-id-collision");
	});

	it("confirms (drops from pending) once the daemon's own surfaceId actually appears in a real WorldViewModel", async () => {
		const fetcher = fetcherReturning(200, { accepted: true });
		const { result, rerender } = renderHook<UseOptimisticDockResult, { viewModel: WorldViewModel }>(({ viewModel }) => useOptimisticDock("http://fake", viewModel, fetcher), { initialProps: { viewModel: EMPTY } });

		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "Activity" }));
		await waitFor(() => expect(result.current.pending).toHaveLength(1));
		const dockedSurfaceId = result.current.pending[0]!.surfaceId;

		rerender({ viewModel: readyWithSurfaces([{ id: dockedSurfaceId, integrationId: "activity", title: "Activity" }]) });

		await waitFor(() => expect(result.current.pending).toHaveLength(0));
	});

	it("clears a previous error once a new dock is attempted", async () => {
		const rejecting = fetcherReturning(400, { message: "nope" });
		const { result } = renderHook(() => useOptimisticDock("http://fake", EMPTY, rejecting));
		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "A" }));
		await waitFor(() => expect(result.current.lastError).toBe("nope"));

		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "B" }));
		expect(result.current.lastError).toBeUndefined();
	});

	it("each dock() call POSTs a real surface.dock CommandIntent with a distinct client-generated surfaceId and commandId", async () => {
		const fetcher = fetcherReturning(200, { accepted: true });
		const { result } = renderHook(() => useOptimisticDock("http://fake", EMPTY, fetcher));

		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "A" }));
		act(() => result.current.dock({ workspaceId: workspaceId("ws"), integrationId: integrationId("activity"), title: "B" }));

		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		const calls = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
		const bodies = calls.map(([, init]) => JSON.parse(String(init.body)).intent);
		expect(bodies[0].type).toBe("surface.dock");
		expect(bodies[0].surfaceId).toBeDefined();
		expect(bodies[0].commandId).toBeDefined();
		expect(bodies[0].surfaceId).not.toBe(bodies[1].surfaceId);
		expect(bodies[0].commandId).not.toBe(bodies[1].commandId);
	});
});
