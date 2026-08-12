import { describe, expect, it } from "vitest";
import { groupSessionsIntoConversations, type SessionMeta } from "./conversation-grouping.js";

function session(overrides: Partial<SessionMeta> & Pick<SessionMeta, "id" | "startedAt">): SessionMeta {
	return {
		filePath: `/sessions/${overrides.id}.jsonl`,
		turns: 1,
		errors: 0,
		...overrides,
	};
}

describe("groupSessionsIntoConversations", () => {
	it("returns one Conversation per unnamed session (1:1, unchanged from today's model)", () => {
		const sessions = [session({ id: "a", startedAt: "2026-01-01T00:00:00Z" }), session({ id: "b", startedAt: "2026-01-02T00:00:00Z" })];
		const result = groupSessionsIntoConversations(sessions);
		expect(result).toHaveLength(2);
		expect(result.every((c) => c.name === undefined)).toBe(true);
		expect(result.map((c) => c.sessionIds)).toEqual([["b"], ["a"]]); // sorted most-recent-first
	});

	it("groups multiple sessions sharing an explicit name into one Conversation", () => {
		const sessions = [
			session({ id: "a", startedAt: "2026-01-01T00:00:00Z", name: "Fix holdover regression" }),
			session({ id: "b", startedAt: "2026-01-03T00:00:00Z", name: "Fix holdover regression" }),
			session({ id: "c", startedAt: "2026-01-02T00:00:00Z", name: "Fix holdover regression" }),
		];
		const result = groupSessionsIntoConversations(sessions);
		expect(result).toHaveLength(1);
		const convo = result[0]!;
		expect(convo.name).toBe("Fix holdover regression");
		// most-recent session first, and identified as the one to actually open
		expect(convo.sessionIds).toEqual(["b", "c", "a"]);
		expect(convo.latestSessionId).toBe("b");
		expect(convo.latestFilePath).toBe("/sessions/b.jsonl");
	});

	it("does not merge sessions with different names, even if similar", () => {
		const sessions = [
			session({ id: "a", startedAt: "2026-01-01T00:00:00Z", name: "Fix holdover regression" }),
			session({ id: "b", startedAt: "2026-01-02T00:00:00Z", name: "Fix holdover regressions" }), // plural -- deliberately different
		];
		const result = groupSessionsIntoConversations(sessions);
		expect(result).toHaveLength(2);
	});

	it("treats an empty or whitespace-only name as unnamed, not as a shared group", () => {
		const sessions = [session({ id: "a", startedAt: "2026-01-01T00:00:00Z", name: "" }), session({ id: "b", startedAt: "2026-01-02T00:00:00Z", name: "   " })];
		const result = groupSessionsIntoConversations(sessions);
		expect(result).toHaveLength(2);
		expect(result.every((c) => c.name === undefined)).toBe(true);
	});

	it("sums turns and errors across a named conversation's constituent sessions", () => {
		const sessions = [
			session({ id: "a", startedAt: "2026-01-01T00:00:00Z", name: "Investigate CI flake", turns: 3, errors: 1 }),
			session({ id: "b", startedAt: "2026-01-02T00:00:00Z", name: "Investigate CI flake", turns: 5, errors: 0 }),
		];
		const result = groupSessionsIntoConversations(sessions);
		expect(result[0]!.totalTurns).toBe(8);
		expect(result[0]!.totalErrors).toBe(1);
	});

	it("sorts conversations by most recently active first, named and unnamed mixed", () => {
		const sessions = [
			session({ id: "old", startedAt: "2026-01-01T00:00:00Z" }),
			session({ id: "a", startedAt: "2026-01-05T00:00:00Z", name: "Named thread" }),
			session({ id: "mid", startedAt: "2026-01-03T00:00:00Z" }),
		];
		const result = groupSessionsIntoConversations(sessions);
		expect(result.map((c) => c.id)).toEqual(["Named thread", "mid", "old"]);
	});

	it("returns an empty list for no sessions", () => {
		expect(groupSessionsIntoConversations([])).toEqual([]);
	});

	it("handles a single unnamed session", () => {
		const result = groupSessionsIntoConversations([session({ id: "solo", startedAt: "2026-01-01T00:00:00Z" })]);
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("solo");
		expect(result[0]!.sessionIds).toEqual(["solo"]);
	});
});
