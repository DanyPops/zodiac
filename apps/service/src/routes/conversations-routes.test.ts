import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversationsRoutes } from "./conversations-routes.js";

let server: Server | undefined;
let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "zodiac-conversations-"));
});

afterEach(() => {
	server?.close();
	server = undefined;
	rmSync(dir, { recursive: true, force: true });
});

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
	return `http://127.0.0.1:${address.port}`;
}

function writeSession(sessionDir: string, id: string, lines: Record<string, unknown>[]): void {
	writeFileSync(join(sessionDir, `${id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}

describe("createConversationsRoutes", () => {
	it("getConversations lists real sessions scanned from the sessions root", async () => {
		const projectDir = join(dir, "project-a");
		mkdirSync(projectDir);
		writeSession(projectDir, "s1", [{ bus: "sense", type: "llm.input", correlationId: "c1", payload: { text: "hi" }, timestamp: 1000 }]);

		const routes = createConversationsRoutes({ sessionsRoot: dir });
		const base = await listen((req, res) => {
			void routes.getConversations(req, res);
		});

		const response = await fetch(`${base}/api/conversations`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { conversations: { id: string }[] };
		expect(body.conversations).toHaveLength(1);
		expect(body.conversations[0]?.id).toBe("s1");
	});

	it("getConversationEvents requires a conversationId query param", async () => {
		const routes = createConversationsRoutes({ sessionsRoot: dir });
		const base = await listen((req, res) => {
			void routes.getConversationEvents(req, res);
		});

		const response = await fetch(`${base}/api/conversations/events`);
		expect(response.status).toBe(400);
	});

	it("getConversationEvents 404s for an unknown conversationId", async () => {
		const routes = createConversationsRoutes({ sessionsRoot: dir });
		const base = await listen((req, res) => {
			void routes.getConversationEvents(req, res);
		});

		const response = await fetch(`${base}/api/conversations/events?conversationId=nope`);
		expect(response.status).toBe(404);
	});

	it("an injected scan/readEvents override (fixture mode) is used instead of the real filesystem scan", async () => {
		const scan = async () => [
			{ id: "fixture", name: "Fixture conversation", sessionIds: ["fixture-session"], latestSessionId: "fixture-session", latestFilePath: "/fixture.jsonl", lastActiveAt: "2026-01-01T00:00:00Z", totalTurns: 0, totalErrors: 0 },
		];
		const readEvents = async () => [];
		const routes = createConversationsRoutes({ sessionsRoot: dir, scan, readEvents });
		const base = await listen((req, res) => {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			if (url.pathname === "/api/conversations") void routes.getConversations(req, res);
			else void routes.getConversationEvents(req, res);
		});

		const list = await fetch(`${base}/api/conversations`).then((r) => r.json());
		expect(list).toMatchObject({ conversations: [{ id: "fixture", name: "Fixture conversation" }] });

		const events = await fetch(`${base}/api/conversations/events?conversationId=fixture`).then((r) => r.json());
		expect(events).toMatchObject({ conversationId: "fixture", events: [] });
	});

	it("getConversationEvents returns the real events for a known conversation", async () => {
		const projectDir = join(dir, "project-a");
		mkdirSync(projectDir);
		writeSession(projectDir, "s1", [{ bus: "sense", type: "llm.input", correlationId: "c1", payload: { text: "hi" }, timestamp: 1000 }]);

		const routes = createConversationsRoutes({ sessionsRoot: dir });
		const base = await listen((req, res) => {
			const url = new URL(req.url ?? "", "http://zodiac.local");
			if (url.pathname === "/api/conversations") void routes.getConversations(req, res);
			else void routes.getConversationEvents(req, res);
		});

		// getConversations must run first -- it's what populates the resolved-
		// conversations lookup getConversationEvents reads from.
		await fetch(`${base}/api/conversations`);
		const response = await fetch(`${base}/api/conversations/events?conversationId=s1`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { events: unknown[] };
		expect(body.events).toHaveLength(1);
	});
});
