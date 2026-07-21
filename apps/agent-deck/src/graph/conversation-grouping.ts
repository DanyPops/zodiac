/**
 * Groups Alef's raw sessions (one JSONL file = one connection/process run,
 * confirmed against ~/Projects/discourse's real session store: `--resume`
 * reopens the same file across process launches, but starting fresh instead
 * of resuming creates a new, unlinked file) into a higher-level Conversation
 * concept that does not exist anywhere in Alef's own domain model today
 * (confirmed via a repo-wide search, zero matches for a Conversation type).
 *
 * V1 heuristic, deliberately conservative: sessions sharing the same
 * explicit session.name event are one Conversation. Unnamed sessions stay
 * 1:1 Conversation:Session. This uses only signal that already exists and
 * was deliberately set by a person (the name), rather than an invented,
 * guessable heuristic like time-proximity -- which risks silently merging
 * unrelated work or splitting one real conversation. See task
 * prototype-conversation-grouping-in-alignment-client-side-ove-emxt.
 */

export interface SessionMeta {
	id: string;
	filePath: string;
	/** From the session.name event (bus:"internal", payload.name), when present. */
	name?: string;
	startedAt: string;
	turns: number;
	errors: number;
}

export interface Conversation {
	/** Stable id: the shared name when named, otherwise the lone session's own id. */
	id: string;
	name: string | undefined;
	sessionIds: string[];
	/**
	 * Multi-session conversations are not merged into one combined event
	 * stream yet (createSessionJsonlSource takes a single file) -- opening
	 * a conversation opens its latest session only. Real, honest scope
	 * limit, not silently pretended away.
	 */
	latestSessionId: string;
	latestFilePath: string;
	lastActiveAt: string;
	totalTurns: number;
	totalErrors: number;
}

export function groupSessionsIntoConversations(sessions: readonly SessionMeta[]): Conversation[] {
	const named = new Map<string, SessionMeta[]>();
	const unnamed: SessionMeta[] = [];

	for (const session of sessions) {
		if (session.name && session.name.trim().length > 0) {
			const group = named.get(session.name);
			if (group) group.push(session);
			else named.set(session.name, [session]);
		} else {
			unnamed.push(session);
		}
	}

	const conversations: Conversation[] = [];

	for (const [name, group] of named) {
		conversations.push(buildConversation(name, group));
	}
	for (const session of unnamed) {
		conversations.push(buildConversation(undefined, [session]));
	}

	conversations.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());
	return conversations;
}

function buildConversation(name: string | undefined, sessions: SessionMeta[]): Conversation {
	const sorted = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
	const latest = sorted[0];
	if (!latest) throw new Error("buildConversation called with no sessions");
	return {
		id: name ?? latest.id,
		name,
		sessionIds: sorted.map((s) => s.id),
		latestSessionId: latest.id,
		latestFilePath: latest.filePath,
		lastActiveAt: latest.startedAt,
		totalTurns: sessions.reduce((sum, s) => sum + s.turns, 0),
		totalErrors: sessions.reduce((sum, s) => sum + s.errors, 0),
	};
}
