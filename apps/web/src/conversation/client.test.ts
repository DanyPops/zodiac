import { describe, expect, it, vi } from "vitest";
import { createHttpConversationClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("HTTP conversation client", () => {
	it("parses the public summary without requiring a filesystem path", async () => {
		const fetcher = vi.fn(async () =>
			jsonResponse({
				conversations: [
					{
						id: "fixture",
						name: "Fixture conversation",
						latestSessionId: "fixture-session",
						lastActiveAt: "2026-01-01T00:00:00.000Z",
						totalTurns: 2,
						totalErrors: 0,
					},
				],
			}),
		);

		const conversations = await createHttpConversationClient({ fetcher: fetcher as typeof fetch }).list();
		expect(conversations[0]?.name).toBe("Fixture conversation");
		expect(conversations[0]).not.toHaveProperty("latestFilePath");
	});

	it("rejects malformed transport data", async () => {
		const fetcher = vi.fn(async () => jsonResponse({ conversations: [{ id: 7 }] }));
		await expect(createHttpConversationClient({ fetcher: fetcher as typeof fetch }).list()).rejects.toThrow(/invalid-conversation/);
	});

	it("encodes the opaque conversation id when loading events", async () => {
		const fetcher = vi.fn(async () => jsonResponse({ events: [] }));
		await createHttpConversationClient({ fetcher: fetcher as typeof fetch }).loadEvents("name/with spaces");
		expect(fetcher).toHaveBeenCalledWith("/api/conversations/events?conversationId=name%2Fwith%20spaces", expect.any(Object));
	});

	it("prefixes every request with the configured baseUrl, for a zodiacd instance not on the same origin", async () => {
		const fetcher = vi.fn(async () => jsonResponse({ conversations: [] }));
		await createHttpConversationClient({ fetcher: fetcher as typeof fetch, baseUrl: "http://127.0.0.1:4390" }).list();
		expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:4390/api/conversations", expect.any(Object));
	});
});
