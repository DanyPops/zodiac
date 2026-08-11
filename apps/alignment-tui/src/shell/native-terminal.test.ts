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

/**
 * A real ECMA-48 CSI sequence's own general grammar (ESC [ params intermediates final-byte),
 * matching ansi-segments.ts's own hardened CSI_RE -- used here independently (not by importing
 * that file's own regex) so this test can't pass merely because it shares a bug with the parser
 * it's meant to catch a leak past. A *legitimate* SGR sequence (final byte `m`, no DEC-private
 * parameter marker) is real, intended content -- exactly what parseAnsiLine consumes and paints as
 * styling, not a leak -- so it's explicitly excluded; anything else matching this grammar is real
 * leaked escape-sequence garbage: mountComponent's own contract is plain text plus SGR only,
 * nothing else should ever reach a person looking at the screen.
 */
const CSI_RE = /\x1b\[([0-?]*)([ -/]*)([@-~])/g;
function isLegitimateSgr(params: string, final: string): boolean {
	return final === "m" && !/[<=>?]/.test(params);
}
function hasStrayEscapeSequence(line: string): boolean {
	CSI_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CSI_RE.exec(line))) {
		if (!isLegitimateSgr(match[1] ?? "", match[3] ?? "")) return true;
	}
	return false;
}

/**
 * These exist specifically because every other assertion in this file (and this session's own
 * earlier work) only ever checked *presence* of expected text via .includes()/toContain -- a line
 * containing "hello-from-real-shell\x1b[?2004h" passes `.includes("hello-from-real-shell")`
 * exactly as cleanly as a garbage-free line would. A real, user-reported bug (a real shell's own
 * bracketed-paste-mode enable sequence, \x1b[?2004h, leaking as literal visible "[?2004h" text on
 * every rendered line) was structurally invisible to every test in this file until this one:
 * `@xterm/addon-serialize`'s serialize() defaults to appending whatever terminal modes are
 * currently active to its own output (meant for "replay this into a fresh real terminal", a
 * concept that never applies here), and this app's own ansi-segments.ts parser only stripped
 * SGR (`\x1b[...m`) sequences -- any other CSI sequence fell through as literal text. Fixed at
 * both layers (serialize({excludeModes: true}) plus a hardened, general CSI-stripping
 * parseAnsiLine) -- this test pins the outward-visible symptom regardless of which layer a future
 * regression comes from.
 */
function assertNoLeakedEscapeSequences(lines: readonly string[]): void {
	for (const line of lines) {
		if (hasStrayEscapeSequence(line)) throw new Error(`render() leaked a non-SGR escape sequence into a line meant to be plain text + SGR only: ${JSON.stringify(line)}`);
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

	it("never leaks a raw escape sequence into any rendered line -- the real regression: a real shell's own bracketed-paste-mode toggle (\\x1b[?2004h), genuinely emitted as real output (confirmed directly, not assumed), must never surface as literal visible text", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		// $SHELL on the machine this runs on is a real interactive shell (zsh/bash), which toggles
		// bracketed paste on its own on every prompt -- no synthetic injection needed to exercise the
		// real path. waitForRender alone is NOT enough here and was directly confirmed (not assumed)
		// to mask this exact bug: it returns the instant "settle-marker" first appears, which can be a
		// transient moment *before* the shell re-enables paste mode while redrawing its next prompt --
		// a real race that let this same test pass against the unfixed code the first time it was
		// written. The extra settle wait below lets that redraw actually finish before checking.
		component.handleInput?.("echo settle-marker\r");
		await waitForRender(component, 80, "settle-marker");
		await new Promise((resolve) => setTimeout(resolve, 500));
		const lines = component.render(80);
		assertNoLeakedEscapeSequences(lines);
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

	/**
	 * A real, user-reported bug: pressing Ctrl+] in a real running Alignment process did nothing.
	 * Root cause confirmed directly (not assumed): every OTHER keybinding in this codebase
	 * (keymap.ts's own Ctrl+E/Ctrl+O/Ctrl+T) is recognized via matchesKey(data, Key.ctrl(...)) --
	 * a matcher proven to handle both the legacy raw C0 control byte AND the Kitty keyboard
	 * protocol's own CSI-u encoding of the same chord (a real terminal negotiating Kitty protocol
	 * with Alignment can send \x1b[93;5u for Ctrl+] instead of the raw \x1d byte -- this codebase's
	 * own keymap.ts already documents exactly this class of encoding difference for other chords).
	 * TerminalPaneComponent's own exit check used a naive `data === "\x1d"` literal comparison
	 * instead, silently forwarding a Kitty-encoded Ctrl+] straight to the child shell as if it were
	 * ordinary input rather than recognizing it as "close the pane".
	 */
	it("Ctrl+] closes the pane via its real Kitty keyboard protocol CSI-u encoding, not just the legacy raw byte", async () => {
		const { host, mounted } = fakeNativeHost();
		openTerminalPaneNatively(host, process.cwd());
		const component = mounted();
		if (!component) throw new Error("no component mounted");

		// ']' is codepoint 93 (0x5D); ";5" is the Kitty protocol's own ctrl-modifier encoding --
		// verified directly against pi-tui's real matchesKey(data, Key.ctrl("]")) before writing this.
		component.handleInput?.("\x1b[93;5u");
		expect(mounted()).toBeUndefined();
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
