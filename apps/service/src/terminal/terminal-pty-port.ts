/**
 * The minimal subset of node-pty's own `IPty` this daemon actually needs --
 * a seam so terminal-session-registry.ts and terminal-routes.ts can be
 * exercised against a fake in tests, the same reason AgentIntegrationPort
 * exists as its own interface rather than every consumer importing a
 * concrete subprocess/RPC implementation directly.
 */
export interface TerminalPtyPort {
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
	/** Adds a listener for raw PTY output; returns an unsubscribe function. Calling this more than once registers independent listeners -- node-pty's own IEvent<T> already supports this natively, which is what makes several attached clients tailing the same live session possible at all. */
	onData(listener: (data: string) => void): () => void;
	/** Fires once, when the underlying shell process exits on its own (not via an explicit kill() from this daemon). */
	onExit(listener: (exitCode: number) => void): () => void;
}

export interface TerminalPtySpawnOptions {
	readonly cwd?: string;
	readonly cols: number;
	readonly rows: number;
}

export type TerminalPtyFactory = (options: TerminalPtySpawnOptions) => TerminalPtyPort;

import * as pty from "node-pty";

/**
 * The real adapter -- node-pty spawning the user's own shell, same
 * technique apps/terminal's own native-terminal.ts already uses (same
 * $SHELL-or-/bin/bash fallback, same env).
 */
export function createNodePtyFactory(): TerminalPtyFactory {
	return ({ cwd, cols, rows }) => {
		const shell = process.env.SHELL && process.env.SHELL.trim().length > 0 ? process.env.SHELL : "/bin/bash";
		const child = pty.spawn(shell, [], { name: "xterm-256color", cols, rows, cwd, env: { ...process.env, TERM: "xterm-256color" } });
		return {
			write: (data) => child.write(data),
			resize: (newCols, newRows) => child.resize(newCols, newRows),
			kill: () => {
				try {
					child.kill();
				} catch {
					/* already exited */
				}
			},
			onData: (listener) => {
				const disposable = child.onData(listener);
				return () => disposable.dispose();
			},
			onExit: (listener) => {
				const disposable = child.onExit(({ exitCode }) => listener(exitCode));
				return () => disposable.dispose();
			},
		};
	};
}
