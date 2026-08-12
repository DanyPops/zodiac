import { randomUUID } from "node:crypto";
import { spawnPiRpcSession, type PiRpcSession, type PiRpcSessionOptions } from "./process-rpc-session.js";

/**
 * Server-side registry of live Pi RPC child processes, keyed by an opaque
 * session id the browser client holds. One entry per Chat surface that has
 * sent at least one live message -- deliberately not tied to a Workspace or
 * request lifecycle, since a session must outlive a single HTTP request
 * (its process keeps running and streaming events between prompts).
 */
export interface PiSessionRegistry {
	create: (options?: PiRpcSessionOptions) => string;
	get: (sessionId: string) => PiRpcSession | undefined;
	remove: (sessionId: string) => void;
	/** Disposes every live session -- called on server shutdown so no `pi` child process is ever orphaned. */
	disposeAll: () => void;
}

export function createPiSessionRegistry(spawn: (options?: PiRpcSessionOptions) => PiRpcSession = spawnPiRpcSession): PiSessionRegistry {
	const sessions = new Map<string, PiRpcSession>();

	return {
		create(options) {
			const sessionId = randomUUID();
			const session = spawn(options);
			session.onExit(() => sessions.delete(sessionId));
			sessions.set(sessionId, session);
			return sessionId;
		},
		get(sessionId) {
			return sessions.get(sessionId);
		},
		remove(sessionId) {
			sessions.get(sessionId)?.dispose();
			sessions.delete(sessionId);
		},
		disposeAll() {
			for (const session of sessions.values()) session.dispose();
			sessions.clear();
		},
	};
}
