import { createRequire } from "node:module";
import type { Component } from "@earendil-works/pi-tui";
import * as pty from "node-pty";

// Same technique as live-pty-terminal.ts/xterm-headless-shim.ts: @xterm/headless and
// @xterm/addon-serialize both ship CJS with no `exports` map, so a plain `import` resolves
// inconsistently between esbuild's own bundling (fine either way) and Vitest's module loader
// (needs this). createRequire sidesteps both consistently, matching the existing convention this
// codebase already established rather than inventing a second way to load the same package.
const require = createRequire(import.meta.url);
const headless = require("@xterm/headless") as { Terminal: new (options: Record<string, unknown>) => XtermHeadlessTerminal };
const serialize = require("@xterm/addon-serialize") as { SerializeAddon: new () => SerializeAddonInstance };

interface XtermHeadlessTerminal {
	write(data: string, callback?: () => void): void;
	resize(cols: number, rows: number): void;
	dispose(): void;
	loadAddon(addon: SerializeAddonInstance): void;
}

interface SerializeAddonInstance {
	activate(terminal: XtermHeadlessTerminal): void;
	serialize(options?: { range?: { start: number; end: number }; excludeModes?: boolean }): string;
}

/** Same shape as native-editor.ts's/native-explorer.ts's own NativeEditorHost/NativeExplorerHost -- all three ultimately mount into the exact same SemanticShellApplication machinery (showExternalComponent/hideExternalComponent/refresh/terminalRows). */
export interface NativeTerminalHost {
	showExternalComponent(component: Component): void;
	hideExternalComponent(): void;
	refresh(): void;
	terminalRows(): number;
}

/**
 * Telnet's own long-established "escape a nested session" precedent (RFC 854's IAC aside,
 * Ctrl+] has been telnet clients' real interactive escape character for decades) -- chosen
 * specifically because a real shell needs virtually every other control byte for real work
 * (Ctrl+C to interrupt a running command, Ctrl+D for EOF, Ctrl+L to clear, Ctrl+R for reverse
 * search, arrows, Tab) and none of those can double as "leave the pane" without breaking that
 * real work. Ctrl+] is a plain C0 control byte (0x1D, ASCII GS) that every terminal delivers
 * unambiguously -- the same reliability bar keymap.ts's own doc comments already hold every
 * other binding in this app to.
 */
const EXIT_SEQUENCE = "\x1d";

const HINT_LINE = "\x1b[2m-- Ctrl+] to close this terminal --\x1b[0m";

/**
 * A real, interactive shell mounted as a pi-tui Component -- the same full-viewport
 * externalComponent mechanism native-editor.ts/native-explorer.ts already use, but backed by a
 * real node-pty child process instead of a Lector-owned buffer. Reuses the exact spawn+reconstruct
 * technique src/test/live-pty-terminal.ts already proved for a live process, applied here to a
 * real production Component instead of a test harness: node-pty for the real child, @xterm/headless
 * for cursor-addressed 2D reconstruction of its output, and @xterm/addon-serialize (verified
 * directly, not assumed) to turn one reconstructed row into a single SGR-styled string with no
 * cursor-repositioning garbage -- exactly the shape mountComponent's own render(width): string[]
 * contract expects.
 *
 * The bottom row is permanently reserved for a hint line (mirrors ModalEditorComponent's own
 * "-2 rows for chrome" convention, here just "-1" since a terminal pane has no separate title
 * row of its own) -- the pty and reconstruction terminal are sized to host.terminalRows() - 1,
 * never the full viewport, so the hint is always visible and never overwritten by the shell's own
 * output.
 */
export class TerminalPaneComponent implements Component {
	private readonly child: pty.IPty;
	private readonly terminal: XtermHeadlessTerminal;
	private readonly serializeAddon: SerializeAddonInstance;
	private writeChain: Promise<void> = Promise.resolve();
	private lastCols = 0;
	private lastRows = 0;
	private closed = false;

	constructor(
		private readonly host: NativeTerminalHost,
		cwd: string,
		private readonly done: () => void,
	) {
		const rows = Math.max(1, host.terminalRows() - 1);
		const cols = 80; // real width arrives on the very first render(width) call, before any output can matter
		this.lastCols = cols;
		this.lastRows = rows;
		const shell = process.env.SHELL && process.env.SHELL.trim().length > 0 ? process.env.SHELL : "/bin/bash";
		this.child = pty.spawn(shell, [], { name: "xterm-256color", cols, rows, cwd, env: { ...process.env, TERM: "xterm-256color" } });
		this.terminal = new headless.Terminal({ cols, rows, allowProposedApi: true });
		this.serializeAddon = new serialize.SerializeAddon();
		this.serializeAddon.activate(this.terminal);

		this.child.onData((data) => {
			this.writeChain = this.writeChain.then(() => new Promise<void>((resolveWrite) => this.terminal.write(data, resolveWrite)));
			void this.writeChain.then(() => this.host.refresh());
		});
		// The shell exited on its own (e.g. the user typed `exit` or `Ctrl+D`'d an empty prompt) --
		// close the pane exactly as if Ctrl+] had been pressed, since there is nothing left to show.
		this.child.onExit(() => this.close());
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		try {
			this.child.kill();
		} catch {
			/* already exited */
		}
		this.terminal.dispose();
		this.host.hideExternalComponent();
		this.done();
		this.host.refresh();
	}

	handleInput(data: string): void {
		if (this.closed) return;
		if (data === EXIT_SEQUENCE) {
			this.close();
			return;
		}
		this.child.write(data);
	}

	/**
	 * Resizing both the child pty and the reconstruction terminal only when dimensions actually
	 * changed (not on every render call) -- and, per this session's own finding migrating
	 * cli.pty.test.ts, resizing a live @xterm/headless Terminal while writes it already queued are
	 * still in flight is a real hazard class. render() is synchronous (pi-tui's own Component
	 * contract), so unlike spawnLiveTerminal's own async resize() this cannot literally await
	 * writeChain first -- a documented, accepted residual risk for v1, not a silently-ignored one.
	 */
	render(width: number): string[] {
		if (this.closed) return [];
		const rows = Math.max(1, this.host.terminalRows() - 1);
		if (width !== this.lastCols || rows !== this.lastRows) {
			this.lastCols = width;
			this.lastRows = rows;
			this.terminal.resize(width, rows);
			try {
				this.child.resize(width, rows);
			} catch {
				/* child may have already exited between the resize check and this call */
			}
		}
		// excludeModes: true -- confirmed directly (a real shell's own bracketed-paste-mode enable
		// sequence, \x1b[?2004h, leaked as literal visible "[?2004h" text on every rendered line
		// before this) that serialize()'s default behavior appends whatever terminal modes are
		// currently active to its output, meant for "replay this into a fresh real terminal to
		// restore state" -- a concept that only makes sense for that literal replay use case, never
		// for handing a row's own visible content to mountComponent's SGR-only parser.
		const lines: string[] = [];
		for (let row = 0; row < rows; row++) lines.push(this.serializeAddon.serialize({ range: { start: row, end: row }, excludeModes: true }));
		lines.push(HINT_LINE);
		return lines;
	}

	invalidate(): void {
		/* nothing cached -- every render() call re-serializes the reconstruction terminal's own current buffer fresh */
	}
}

/**
 * Opens a real shell at `cwd`, mounted natively -- no AgentSession, no ExtensionRunner, no Pi
 * extension involvement at all, matching openLectorEditorNatively/openLectorExplorerNatively's own
 * contract exactly (same host shape, same showExternalComponent/hideExternalComponent mechanism).
 */
export function openTerminalPaneNatively(host: NativeTerminalHost, cwd: string): void {
	const component = new TerminalPaneComponent(host, cwd, () => {
		/* nothing further to do -- close() already called hideExternalComponent()/refresh() itself */
	});
	host.showExternalComponent(component);
	host.refresh();
}
