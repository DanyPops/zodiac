import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { openTerminalPaneNatively, TerminalPaneComponent } from "./native-terminal.js";

/** Same "record, don't render" pattern native-editor.test.ts's own fakeNativeHost already uses. */
function fakeNativeHost() {
	let mounted: Component | undefined;
	let rows = 24;
	return {
		host: {
			showExternalComponent(component: Component): void {
				mounted = component;
			},
			hideExternalComponent(): void {
				mounted = undefined;
			},
			refresh(): void {},
			terminalRows(): number {
				return rows;
			},
		},
		mounted: () => mounted,
		setRows: (value: number) => {
			rows = value;
		},
	};
}

/** Polls render(width) until `expected` appears in its output, or times out -- the same shape as live-pty-terminal.ts's own poll(), needed here because real child-process output always arrives asynchronously via onData. */
async function waitForRender(component: Component, width: number, expected: string, timeoutMs = 8000): Promise<string[]> {
	const startedAt = Date.now();
	for (;;) {
		const lines = component.render(width);
		if (lines.some((line) => line.includes(expected))) return lines;
		if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for terminal pane render to contain ${JSON.stringify(expected)}; last render:\n${lines.join("\n")}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

describe("TerminalPaneComponent -- a real shell mounted natively, no Lector, no AgentSession, no Pi extension involvement at all", () => {
	it("mounts a real shell and reflects its real output through render()", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		expect(component).toBeDefined();
		if (!component) return;

		component.handleInput?.("echo hello-from-real-shell\r");
		await waitForRender(component, 80, "hello-from-real-shell");
	});

	it("shows the permanent hint line at the bottom row", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		const lines = component.render(80);
		expect(lines.at(-1)).toContain("Ctrl+]");
	});

	it("forwards a real command's real exit code through the shell, proving input actually reaches the child process", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		component.handleInput?.("echo before && false; echo exit-code-is-$?\r");
		await waitForRender(component, 80, "exit-code-is-1");
	});

	it("Ctrl+] closes the pane -- hides the external component and kills the real child process", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		component.handleInput?.("\x1d");
		expect(host.showExternalComponent).toBeDefined(); // sanity: host itself still usable
		expect(mounted()).toBeUndefined(); // hideExternalComponent() was called

		// After close(), render() and further input must be safe no-ops, not throw against a
		// disposed reconstruction terminal or a killed child process.
		expect(component.render(80)).toEqual([]);
		expect(() => component.handleInput?.("echo still safe\r")).not.toThrow();
	});

	it("the shell exiting on its own (a real `exit`) closes the pane exactly like Ctrl+] does", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		component.handleInput?.("exit\r");
		await new Promise<void>((resolve, reject) => {
			const startedAt = Date.now();
			const tick = () => {
				if (mounted() === undefined) return resolve();
				if (Date.now() - startedAt > 8000) return reject(new Error("pane never closed after the shell exited on its own"));
				setTimeout(tick, 20);
			};
			tick();
		});
	});

	it("resizes the real child pty when the mounted width or the host's reported row count changes between renders -- checked via `stty size`, the real kernel ioctl value, not a shell variable's own refresh timing", async () => {
		const { host, mounted, setRows } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		component.render(80); // establishes the initial 80x23 (24 - 1 hint row) size
		component.handleInput?.("stty size\r");
		await waitForRender(component, 80, "23 80");

		setRows(30);
		component.render(100); // resize only actually happens inside render(), not handleInput()
		component.handleInput?.("stty size\r");
		await waitForRender(component, 100, "29 100"); // 30 host rows - 1 hint row
	});
});

describe("TerminalPaneComponent constructed directly (not through openTerminalPaneNatively)", () => {
	it("calls its own done() callback exactly once when closed via Ctrl+]", async () => {
		const { host } = fakeNativeHost();
		let doneCalls = 0;
		const component = new TerminalPaneComponent(host, process.cwd(), () => {
			doneCalls++;
		});
		component.handleInput("\x1d");
		expect(doneCalls).toBe(1);
		component.handleInput("\x1d"); // idempotent -- already closed
		expect(doneCalls).toBe(1);
	});
});
