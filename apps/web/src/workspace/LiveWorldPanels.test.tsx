/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldViewModel } from "@zodiac/protocol";
import { LiveWorldPanels } from "./LiveWorldPanels.js";

afterEach(cleanup);

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function createFakeDaemon() {
	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world/panels")) return new Response(JSON.stringify({ panels: [] }), { status: 200 });
		if (url.endsWith("/api/world") && (!init || init.method === undefined)) return new Response(JSON.stringify(EMPTY), { status: 200 });
		if (url.endsWith("/api/world/events")) return new Response(new ReadableStream(), { status: 200, headers: { "Content-Type": "text/event-stream" } });
		if (url.endsWith("/api/world/commands") && init?.method === "POST") return new Response(JSON.stringify({ accepted: true }), { status: 200 });
		throw new Error(`fake daemon: unhandled request ${url}`);
	});
	return fetcher;
}

describe("LiveWorldPanels", () => {
	it("reports panels() once connected, renders nothing itself", () => {
		const onPanels = vi.fn();
		const { container } = render(<LiveWorldPanels baseUrl="http://fake" onPanels={onPanels} onApply={vi.fn()} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("reports a real, callable apply() once connected -- dispatching through it posts to the daemon's own command route", async () => {
		vi.stubGlobal("fetch", createFakeDaemon());
		const onApply = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={onApply} />);

		await waitFor(() => expect(onApply).toHaveBeenCalled());
		const apply = onApply.mock.calls.at(-1)![0] as (intent: unknown) => void;
		apply({ type: "panel.resize", panelId: "workspace-nav", thickness: 256 });

		await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/world/commands"), expect.objectContaining({ method: "POST" })));
		vi.unstubAllGlobals();
	});

	it("reports the live WorldViewModel via onWorldViewModel once connected, for a caller that needs more than Panel chrome", async () => {
		vi.stubGlobal("fetch", createFakeDaemon());
		const onWorldViewModel = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={vi.fn()} onWorldViewModel={onWorldViewModel} />);

		await waitFor(() => expect(onWorldViewModel).toHaveBeenCalledWith(EMPTY));
		vi.unstubAllGlobals();
	});

	it("never calls onWorldViewModel when the caller omits it -- optional, not required", async () => {
		vi.stubGlobal("fetch", createFakeDaemon());
		const onApply = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={onApply} />);
		await waitFor(() => expect(onApply).toHaveBeenCalled());
		vi.unstubAllGlobals();
	});
});
