import type { Conversation, NormalizedEvent } from "@zodiac/server/conversations";

/**
 * Deterministic, filesystem-free stand-ins for Playwright's system suite
 * (ZODIAC_FIXTURE_MODE=1) -- moved from apps/web's own Vite dev-only
 * zodiacApiPlugin (see the "Zodiac state architecture" Papyrus Doc). No
 * assertion in the system suite actually inspects a fixture conversation's
 * own content; this exists purely so a test run never scans a real
 * developer machine's actual ~/.local/share/alef/sessions (slow, huge, or
 * simply absent in CI) just to boot the app.
 */
export async function fixtureScanConversations(): Promise<Conversation[]> {
	const now = new Date();
	return [
		{
			id: "fixture",
			name: "Fixture conversation",
			sessionIds: ["fixture-session"],
			latestSessionId: "fixture-session",
			latestFilePath: "fixture-session.jsonl",
			lastActiveAt: now.toISOString(),
			totalTurns: 2,
			totalErrors: 0,
		},
		{
			id: "fixture-secondary",
			name: "Secondary fixture conversation",
			sessionIds: ["fixture-session-secondary"],
			latestSessionId: "fixture-session-secondary",
			latestFilePath: "fixture-session-secondary.jsonl",
			lastActiveAt: new Date(now.getTime() - 60_000).toISOString(),
			totalTurns: 2,
			totalErrors: 0,
		},
	];
}

/**
 * The exact same content as packages/server/test/fixtures/session-sample.jsonl
 * (also used by that package's own conversation-scanning tests and by
 * apps/web's projector.test.ts), reproduced as NormalizedEvent literals
 * instead of reading that file at runtime -- see this module's own
 * `fixtureScanConversations` doc comment for why (a bundled dist/cli.js's
 * import.meta.url can't locate a cross-package test asset at a fixed
 * relative depth from both source and bundle contexts). Kept byte-faithful
 * to that file's real records (skipping its one deliberately-malformed
 * line) so a Playwright visual baseline captured against either produces
 * an identical render.
 */
export async function fixtureReadSessionEvents(): Promise<NormalizedEvent[]> {
	const sourceId = "session-jsonl:fixture-session";
	const sessionId = "fixture-session";
	const turn1 = "11111111-1111-1111-1111-111111111111";
	const turn2 = "22222222-2222-2222-2222-222222222222";
	return [
		{ sourceId, sessionId, bus: "sense", type: "dialog.message", correlationId: turn1, payload: { text: "Please read the readme", sender: "user", messages: [], tools: ["fs.read"] }, timestamp: 1000 },
		{ sourceId, sessionId, bus: "sense", type: "llm.result", correlationId: turn1, payload: {}, timestamp: 1010, elapsed: 10 },
		{ sourceId, sessionId, bus: "motor", type: "llm.result", correlationId: turn1, payload: { response: "", toolCalls: [{ id: "tc-1", name: "fs.read" }], turn: 1 }, timestamp: 1020 },
		{ sourceId, sessionId, bus: "motor", type: "fs.read", correlationId: turn1, payload: { path: "example-readme.md", toolCallId: "tc-1" }, timestamp: 1030, toolCallId: "tc-1" },
		{ sourceId, sessionId, bus: "sense", type: "fs.read", correlationId: turn1, payload: { content: "# Example\n", truncated: false, totalLines: 1, toolCallId: "tc-1" }, timestamp: 1040, elapsed: 10, hash: "deadbeef", toolCallId: "tc-1" },
		{ sourceId, sessionId, bus: "sense", type: "llm.result", correlationId: turn1, payload: {}, timestamp: 1050 },
		{ sourceId, sessionId, bus: "motor", type: "llm.result", correlationId: turn1, payload: { response: "The readme says hello.", toolCalls: [], turn: 1 }, timestamp: 1060 },
		{ sourceId, sessionId, bus: "motor", type: "dialog.message", correlationId: turn1, payload: { text: "The readme says hello.", usage: { tokens: 42 } }, timestamp: 1070 },
		{ sourceId, sessionId, bus: "sense", type: "dialog.message", correlationId: turn2, payload: { text: "Thanks", sender: "user" }, timestamp: 2000 },
		{ sourceId, sessionId, bus: "motor", type: "dialog.message", correlationId: turn2, payload: { text: "You're welcome!", usage: { tokens: 10 } }, timestamp: 2010 },
	];
}
