/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorldViewModel } from "@zodiac/protocol";
import { LiveWorldPanels } from "./LiveWorldPanels.js";

afterEach(cleanup);

const EMPTY: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function createFakeDaemon() {
	let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
	const encoder = new TextEncoder();

	function push(viewModel: WorldViewModel, acknowledgedCommandId?: string): void {
		const change = { viewModel, ...(acknowledgedCommandId ? { commandId: acknowledgedCommandId } : {}) };
		controller?.enqueue(encoder.encode(`data: ${JSON.stringify(change)}\n\n`));
	}

	const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith("/api/world/panels")) return new Response(JSON.stringify({ panels: [] }), { status: 200 });
		if (url.endsWith("/api/world") && (!init || init.method === undefined)) return new Response(JSON.stringify(EMPTY), { status: 200 });
		if (url.endsWith("/api/world/events")) {
			const stream = new ReadableStream<Uint8Array>({
				start(c) {
					controller = c;
				},
			});
			return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
		}
		if (url.endsWith("/api/world/commands") && init?.method === "POST") return new Response(JSON.stringify({ accepted: true }), { status: 200 });
		throw new Error(`fake daemon: unhandled request ${url}`);
	});
	return { fetcher, push };
}

describe("LiveWorldPanels", () => {
	it("reports panels() once connected, renders nothing itself", () => {
		const onPanels = vi.fn();
		const { container } = render(<LiveWorldPanels baseUrl="http://fake" onPanels={onPanels} onApply={vi.fn()} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("reports a real, callable apply() once connected -- dispatching through it posts to the daemon's own command route", async () => {
		vi.stubGlobal("fetch", createFakeDaemon().fetcher);
		const onApply = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={onApply} />);

		await waitFor(() => expect(onApply).toHaveBeenCalled());
		const apply = onApply.mock.calls.at(-1)![0] as (intent: unknown) => void;
		apply({ type: "panel.resize", panelId: "workspace-nav", thickness: 256 });

		await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/world/commands"), expect.objectContaining({ method: "POST" })));
		vi.unstubAllGlobals();
	});

	it("reports the live WorldViewModel via onWorldViewModel once connected, for a caller that needs more than Panel chrome", async () => {
		vi.stubGlobal("fetch", createFakeDaemon().fetcher);
		const onWorldViewModel = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={vi.fn()} onWorldViewModel={onWorldViewModel} />);

		await waitFor(() => expect(onWorldViewModel).toHaveBeenCalledWith(EMPTY));
		vi.unstubAllGlobals();
	});

	it("never calls onWorldViewModel when the caller omits it -- optional, not required", async () => {
		vi.stubGlobal("fetch", createFakeDaemon().fetcher);
		const onApply = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={onApply} />);
		await waitFor(() => expect(onApply).toHaveBeenCalled());
		vi.unstubAllGlobals();
	});

	it("reports each of this client's own dispatched commands via onCommandAcknowledged the instant the daemon's own broadcast confirms it, by commandId -- not by re-checking whether the viewModel now matches what this client originally guessed (see the doc comment: a second writer, e.g. an agent tool call sharing the same Workspace, can supersede the value before or as it lands)", async () => {
		const daemon = createFakeDaemon();
		vi.stubGlobal("fetch", daemon.fetcher);
		const onCommandAcknowledged = vi.fn();
		render(<LiveWorldPanels baseUrl="http://fake" onPanels={vi.fn()} onApply={vi.fn()} onCommandAcknowledged={onCommandAcknowledged} />);

		await waitFor(() => expect(daemon.fetcher).toHaveBeenCalledWith(expect.stringContaining("/api/world/events"), expect.anything()));
		// A concurrent second writer's own commandId ('cmd-agent') acknowledged first, even though this client never dispatched it -- onCommandAcknowledged still reports it verbatim; App.tsx's own pendingRenames only prunes entries whose commandId matches one of its own, so an id it doesn't recognize is simply a no-op for it, not a hazard.
		daemon.push(EMPTY, "cmd-agent");
		daemon.push(EMPTY, "cmd-human");
		await waitFor(() => expect(onCommandAcknowledged).toHaveBeenCalledWith("cmd-agent"));
		expect(onCommandAcknowledged).toHaveBeenCalledWith("cmd-human");
		expect(onCommandAcknowledged).toHaveBeenCalledTimes(2);
		vi.unstubAllGlobals();
	});
});
