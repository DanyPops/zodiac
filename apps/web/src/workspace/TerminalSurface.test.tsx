/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalClient, TerminalConnection, TerminalConnectionHandlers } from "../terminal/terminal-client.js";
import { createXtermUi } from "../terminal/terminal-ui-port.js";
import type { TerminalUiPort } from "../terminal/terminal-ui-port.js";
import { TerminalSurfaceContent } from "./TerminalSurface.js";

afterEach(() => {
	cleanup();
});

/** A DOM-free stand-in for real xterm.js -- the same seam-and-fake pattern the rest of this codebase already uses server-side (TerminalPtyPort) so component tests assert data flow, not real terminal rendering. */
function fakeUi(): TerminalUiPort & { writes: string[]; disposed: boolean; emitData(data: string): void; emitResize(cols: number, rows: number): void } {
	const dataListeners = new Set<(data: string) => void>();
	let resizeListener: ((cols: number, rows: number) => void) | undefined;
	const state = {
		writes: [] as string[],
		disposed: false,
		mount: vi.fn((_container: HTMLElement, onResize: (cols: number, rows: number) => void) => {
			resizeListener = onResize;
			return { cols: 80, rows: 24 };
		}),
		write: (data: string) => state.writes.push(data),
		onData: (listener: (data: string) => void) => {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		dispose: () => {
			state.disposed = true;
		},
		emitData(data: string) {
			for (const listener of dataListeners) listener(data);
		},
		emitResize(cols: number, rows: number) {
			resizeListener?.(cols, rows);
		},
	};
	return state;
}

function fakeClient(): TerminalClient & { createSession: ReturnType<typeof vi.fn>; connections: (TerminalConnection & { handlers: TerminalConnectionHandlers; resizes: [number, number][] })[] } {
	const connections: (TerminalConnection & { handlers: TerminalConnectionHandlers; resizes: [number, number][] })[] = [];
	return {
		createSession: vi.fn(async () => "session-1"),
		connect(_sessionId, handlers) {
			const resizes: [number, number][] = [];
			const connection = {
				sendInput: vi.fn(),
				resize: vi.fn((cols: number, rows: number) => resizes.push([cols, rows])),
				close: vi.fn(),
				handlers,
				resizes,
			};
			connections.push(connection);
			return connection;
		},
		connections,
	};
}

describe("TerminalSurfaceContent", () => {
	it("spawns a new session via client.createSession when no sessionId prop is given, then connects to it", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} />);

		expect(client.createSession).toHaveBeenCalledOnce();
		await waitFor(() => expect(client.connections).toHaveLength(1));
	});

	it("attaches directly to an already-live session when sessionId is given, without spawning a new one", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} sessionId="already-live" />);

		expect(client.createSession).not.toHaveBeenCalled();
		await waitFor(() => expect(client.connections).toHaveLength(1));
	});

	it("resizes the connection to the terminal's own initial size once connected", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} />);

		await waitFor(() => expect(client.connections[0]?.resizes).toEqual([[80, 24]]));
	});

	it("a resize from the UI (e.g. the panel changing size) is forwarded to the connection", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		ui.emitResize(120, 40);
		expect(client.connections[0]?.resizes).toEqual([
			[80, 24],
			[120, 40],
		]);
	});

	it("a keystroke typed directly into the UI is sent as input over the connection", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		ui.emitData("ls\n");
		expect(client.connections[0]?.sendInput).toHaveBeenCalledWith("ls\n");
	});

	it("output arriving over the connection is written to the UI", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		client.connections[0]?.handlers.onOutput("hello from the shell");
		expect(ui.writes).toEqual(["hello from the shell"]);
	});

	it("shows a 'shell exited' notice when the connection reports an exit", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		const { findByText } = render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		client.connections[0]?.handlers.onExit(1);
		expect(await findByText(/shell exited/i)).toBeTruthy();
	});

	it("shows an error notice when the connection reports an error", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		const { findByText } = render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		client.connections[0]?.handlers.onError?.(new Error("boom"));
		expect(await findByText(/connection error/i)).toBeTruthy();
	});

	it("unmounting closes the connection and disposes the UI -- a docked panel closing must never leak either", async () => {
		const client = fakeClient();
		const ui = fakeUi();
		const { unmount } = render(<TerminalSurfaceContent client={client} createUi={() => ui} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));

		unmount();
		expect(client.connections[0]?.close).toHaveBeenCalledOnce();
		expect(ui.disposed).toBe(true);
	});

	it("real xterm.js mounts and unmounts cleanly (createXtermUi, the actual production adapter) -- a smoke test, not a rendering assertion", async () => {
		const client = fakeClient();
		const { unmount } = render(<TerminalSurfaceContent client={client} createUi={createXtermUi} />);
		await waitFor(() => expect(client.connections).toHaveLength(1));
		expect(() => unmount()).not.toThrow();
	});
});
