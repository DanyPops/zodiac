/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorldViewModel } from "@zodiac/protocol";
import { workspaceId } from "@zodiac/protocol";
import { LiveDaemonPanel } from "./LiveDaemonPanel.js";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const READY: WorldViewModel = {
	state: "ready",
	activeWorkspaceId: workspaceId("ws"),
	workspaces: [{ id: workspaceId("ws"), title: "Bug Triage", activeWindowId: "window-1", windows: [{ id: "window-1", title: "Window 0", active: true, surfaces: [], tile: null }], activeIntegrationIds: [] }],
} as unknown as WorldViewModel;

function stubFetch(dockResponse: { status: number; body: unknown }): ReturnType<typeof vi.fn> {
	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world") && (!init || init.method === undefined)) return new Response(JSON.stringify(READY), { status: 200 });
		if (url.endsWith("/api/world/events")) return new Response(new ReadableStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
		if (url.endsWith("/api/world/commands")) return new Response(JSON.stringify(dockResponse.body), { status: dockResponse.status });
		throw new Error(`unhandled request ${url}`);
	});
	vi.stubGlobal("fetch", fetcher);
	return fetcher;
}

describe("LiveDaemonPanel", () => {
	it("toggles the expanded panel on click", async () => {
		stubFetch({ status: 200, body: { accepted: true } });
		render(<LiveDaemonPanel baseUrl="http://fake" />);
		expect(screen.queryByTestId("live-world-tiles")).toBeNull();

		fireEvent.click(screen.getByText(/Live Daemon State/));
		await waitFor(() => expect(screen.getByTestId("live-world-tiles")).toBeInTheDocument());
	});

	it("Dock Activity renders a pending placeholder, then confirms once the daemon accepts it", async () => {
		stubFetch({ status: 200, body: { accepted: true } });
		render(<LiveDaemonPanel baseUrl="http://fake" />);
		fireEvent.click(screen.getByText(/Live Daemon State/));
		await waitFor(() => expect(screen.getByTestId("live-daemon-dock-activity")).toBeInTheDocument());

		fireEvent.click(screen.getByTestId("live-daemon-dock-activity"));
		expect(screen.getByTestId("live-daemon-pending")).toBeInTheDocument();
	});

	it("emits the connection's own view-model diff to emitExtensionEvent as the daemon's real WorldViewModel changes", async () => {
		stubFetch({ status: 200, body: { accepted: true } });
		const emitExtensionEvent = vi.fn();
		render(<LiveDaemonPanel baseUrl="http://fake" emitExtensionEvent={emitExtensionEvent} />);

		await waitFor(() => expect(emitExtensionEvent).toHaveBeenCalledWith({ type: "workspace:selected", workspaceId: "ws" }));
	});

	it("Dock Activity rolls back and shows a real error when the daemon rejects the command", async () => {
		stubFetch({ status: 400, body: { message: "surface-id-collision" } });
		render(<LiveDaemonPanel baseUrl="http://fake" />);
		fireEvent.click(screen.getByText(/Live Daemon State/));
		await waitFor(() => expect(screen.getByTestId("live-daemon-dock-activity")).toBeInTheDocument());

		fireEvent.click(screen.getByTestId("live-daemon-dock-activity"));
		await waitFor(() => expect(screen.getByTestId("live-daemon-dock-error")).toHaveTextContent("surface-id-collision"));
		expect(screen.queryByTestId("live-daemon-pending")).toBeNull();
	});
});
