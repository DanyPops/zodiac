import type { Conversation } from "../graph/conversation-grouping.js";

/**
 * Synthetic, in-memory Conversation data for the sketched layout -- no disk
 * scan, no /api/conversations fetch, no dependency on real local Alef
 * sessions. This is a deliberate simplification for the current layout/
 * drag-drop build phase: the real Conversation picker (conversation-picker.ts,
 * conversations-api.ts) is separate, already-shipped, tested work and is
 * untouched -- this mock store exists so the sketched layout can be
 * iterated on and demoed without needing a dev server that scans real
 * session files each time.
 */
export function mockConversations(): Conversation[] {
	return [
		{
			id: "Investigate CI flake",
			name: "Investigate CI flake",
			sessionIds: ["s1"],
			latestSessionId: "s1",
			latestFilePath: "",
			lastActiveAt: new Date(Date.now() - 5 * 60_000).toISOString(),
			totalTurns: 6,
			totalErrors: 0,
		},
		{
			id: "Fix failover pin race",
			name: "Fix failover pin race",
			sessionIds: ["s2"],
			latestSessionId: "s2",
			latestFilePath: "",
			lastActiveAt: new Date(Date.now() - 45 * 60_000).toISOString(),
			totalTurns: 12,
			totalErrors: 1,
		},
		{
			id: "s3",
			name: undefined,
			sessionIds: ["s3"],
			latestSessionId: "s3",
			latestFilePath: "",
			lastActiveAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
			totalTurns: 2,
			totalErrors: 0,
		},
		{
			id: "Review PR feedback",
			name: "Review PR feedback",
			sessionIds: ["s4"],
			latestSessionId: "s4",
			latestFilePath: "",
			lastActiveAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
			totalTurns: 4,
			totalErrors: 0,
		},
	];
}

export interface ConversationsStore {
	list(): Conversation[];
}

/** In-memory store -- trivial now, but a real interface seam so a live/real-data store can replace it later without touching callers. */
export function createInMemoryConversationsStore(seed: readonly Conversation[] = mockConversations()): ConversationsStore {
	const conversations = [...seed];
	return {
		list: () => conversations,
	};
}
