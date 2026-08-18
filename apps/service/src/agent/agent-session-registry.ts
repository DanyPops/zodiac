import { randomUUID } from "node:crypto";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";

/** Bounds per-session history the same way conversations-api.ts bounds its own read -- an adversarial or very long-running session must not grow this without limit. */
const MAX_HISTORY_EVENTS = 5_000;

export interface AgentSessionSummary {
	sessionId: string;
	createdAt: number;
}

export interface AgentSessionRegistry {
	/** Constructs a fresh AgentIntegrationPort via the injected factory. Both args forward unchanged; initialActiveToolNames carries a Workspace's own resolved tool grant (see agent-routes.ts's createSession). */
	create: (cwd?: string, initialActiveToolNames?: readonly string[]) => Promise<string>;
	list: () => readonly AgentSessionSummary[];
	get: (sessionId: string) => AgentIntegrationPort | undefined;
	/** Every ZodiacAgentEvent this session has emitted so far, in order -- for a newly-attaching SSE subscriber to replay before switching to live tail (see the "zodiacd API surface" Papyrus Doc). */
	history: (sessionId: string) => readonly ZodiacAgentEvent[];
	remove: (sessionId: string) => void;
	/** Disposes every live session -- called on daemon shutdown so no agent session is ever silently orphaned. */
	disposeAll: () => void;
}

interface Entry {
	readonly createdAt: number;
	readonly integration: AgentIntegrationPort;
	readonly history: ZodiacAgentEvent[];
}

/**
 * Daemon-side registry of live agent sessions, one AgentIntegrationPort per
 * entry -- parameterized over how that port is constructed (a real
 * createZodiacAgentSession(...).integration in production, a fake port in
 * tests), the same shape apps/web's own PiSessionRegistry already
 * established for its (now-superseded, zodiacd stage 4) subprocess sessions.
 */
export function createAgentSessionRegistry(createIntegration: (cwd?: string, initialActiveToolNames?: readonly string[]) => AgentIntegrationPort | Promise<AgentIntegrationPort>): AgentSessionRegistry {
	const sessions = new Map<string, Entry>();

	return {
		async create(cwd?: string, initialActiveToolNames?: readonly string[]): Promise<string> {
			const sessionId = randomUUID();
			const integration = await createIntegration(cwd, initialActiveToolNames);
			const entry: Entry = { createdAt: Date.now(), integration, history: [] };
			integration.onEvent((event) => {
				entry.history.push(event);
				if (entry.history.length > MAX_HISTORY_EVENTS) entry.history.shift();
			});
			integration.onExit(() => sessions.delete(sessionId));
			sessions.set(sessionId, entry);
			return sessionId;
		},
		list(): AgentSessionSummary[] {
			return [...sessions.entries()].map(([sessionId, entry]) => ({ sessionId, createdAt: entry.createdAt }));
		},
		get(sessionId): AgentIntegrationPort | undefined {
			return sessions.get(sessionId)?.integration;
		},
		history(sessionId): readonly ZodiacAgentEvent[] {
			return sessions.get(sessionId)?.history ?? [];
		},
		remove(sessionId): void {
			sessions.get(sessionId)?.integration.dispose();
			sessions.delete(sessionId);
		},
		disposeAll(): void {
			for (const entry of sessions.values()) entry.integration.dispose();
			sessions.clear();
		},
	};
}
