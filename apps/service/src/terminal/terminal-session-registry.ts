import { randomUUID } from "node:crypto";
import type { TerminalPtyFactory, TerminalPtyPort } from "./terminal-pty-port.js";

/** Bounds buffered output the same way agent-session-registry.ts bounds its own event history -- an adversarial or very long-running shell must not grow this without limit. ~200KB of scrollback is generous for a replay buffer. */
const DEFAULT_MAX_HISTORY_CHARS = 200_000;

/** A new terminal session's own default size before its first real resize from an attaching client -- matches native-terminal.ts's own "real width arrives on the very first render" fallback in spirit. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export interface TerminalSessionSummary {
	sessionId: string;
	createdAt: number;
}

export interface TerminalSessionRegistryOptions {
	maxHistoryChars?: number;
}

export interface TerminalSessionRegistry {
	/** Spawns a real pty via the injected factory and registers it under a new opaque id -- persistent and detachable (survives any one client connection's lifetime), matching VS Code's own PersistentTerminalProcess (see the "zodiacd API surface" Papyrus Doc's Terminal sessions section). */
	create: (cwd?: string) => string;
	list: () => readonly TerminalSessionSummary[];
	get: (sessionId: string) => TerminalPtyPort | undefined;
	/** Every byte of output this session's pty has produced so far, bounded -- for a newly-attaching (or reattaching) client to replay before switching to live tail. */
	history: (sessionId: string) => string;
	/** Kills the pty and drops it from the registry -- an explicit close, distinct from the shell exiting on its own. */
	remove: (sessionId: string) => void;
	/** Kills every live session -- called on daemon shutdown so no shell is ever silently orphaned. */
	disposeAll: () => void;
}

interface Entry {
	readonly createdAt: number;
	readonly port: TerminalPtyPort;
	history: string;
}

/**
 * Daemon-side registry of live, persistent terminal sessions, one real pty
 * per entry -- parameterized over how that pty is constructed (a real
 * node-pty child in production via createNodePtyFactory, a fake port in
 * tests), the same shape createAgentSessionRegistry already established for
 * agent sessions.
 */
export function createTerminalSessionRegistry(spawn: TerminalPtyFactory, options: TerminalSessionRegistryOptions = {}): TerminalSessionRegistry {
	const maxHistoryChars = options.maxHistoryChars ?? DEFAULT_MAX_HISTORY_CHARS;
	const sessions = new Map<string, Entry>();

	return {
		create(cwd?: string): string {
			const sessionId = randomUUID();
			const port = spawn({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS });
			const entry: Entry = { createdAt: Date.now(), port, history: "" };
			port.onData((data) => {
				entry.history = (entry.history + data).slice(-maxHistoryChars);
			});
			port.onExit(() => sessions.delete(sessionId));
			sessions.set(sessionId, entry);
			return sessionId;
		},
		list(): TerminalSessionSummary[] {
			return [...sessions.entries()].map(([sessionId, entry]) => ({ sessionId, createdAt: entry.createdAt }));
		},
		get(sessionId): TerminalPtyPort | undefined {
			return sessions.get(sessionId)?.port;
		},
		history(sessionId): string {
			return sessions.get(sessionId)?.history ?? "";
		},
		remove(sessionId): void {
			sessions.get(sessionId)?.port.kill();
			sessions.delete(sessionId);
		},
		disposeAll(): void {
			for (const entry of sessions.values()) entry.port.kill();
			sessions.clear();
		},
	};
}
