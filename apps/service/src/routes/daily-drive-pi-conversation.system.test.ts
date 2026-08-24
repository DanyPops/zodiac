import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { createAgentSessionRegistry } from "../agent/agent-session-registry.js";
import { createAgentRoutes } from "./agent-routes.js";

/**
 * "daily-drive" acceptance -- checklist item "Pi is driven through Zodiac":
 * the user converses with Pi (a real prompt dispatch) and observes real
 * tool activity (tool-call-start/update/end), entirely through zodiacd's
 * own HTTP+SSE transport -- the identical one apps/web's own conversation
 * client reads -- never Pi's own interactive TUI/CLI.
 *
 * Uses an injectable AgentIntegrationPort fixture rather than a real LLM
 * conversation, matching this suite's own established precedent (see
 * agent-command-tool-daemon-wiring.system.test.ts's own doc comment: real
 * LLM auth isn't available/desirable in this suite). The real production
 * wiring from an HTTP session to a live Pi SDK conversation
 * (createZodiacAgentSession/createInProcessAgentIntegration) is proven
 * separately by agent-command-tool-daemon-wiring.system.test.ts and
 * list-visual-cues-tool-daemon-wiring.system.test.ts; this test's own job
 * is the conversation+tool-activity relay itself, end to end over the real
 * transport, unaffected by which AgentIntegrationPort backs the session.
 */
function fixtureIntegration(): AgentIntegrationPort & { emit(event: ZodiacAgentEvent): void; readonly prompts: string[] } {
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	const prompts: string[] = [];
	return {
		prompts,
		prompt: vi.fn(async (text: string) => {
			prompts.push(text);
		}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		onEvent: (listener) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit: () => () => {},
		dispose: vi.fn(),
		emit(event) {
			for (const listener of eventListeners) listener(event);
		},
	};
}

let server: Server | undefined;

afterEach(() => {
	server?.close();
	server = undefined;
});

async function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<string> {
	server = createServer(handler);
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
	return `http://127.0.0.1:${address.port}`;
}

describe("daily-drive: Pi conversation acceptance", () => {
	it("dispatches a real prompt and streams a full tool-call sequence plus the final assistant message over zodiacd's own SSE transport", async () => {
		const integration = fixtureIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			const url = new URL(req.url ?? "/", base);
			if (req.method === "POST" && url.pathname === "/api/agent/sessions") { void routes.createSession(req, res); return; }
			const eventsMatch = /^\/api\/agent\/sessions\/([^/]+)\/events$/.exec(url.pathname);
			if (req.method === "GET" && eventsMatch) { void routes.streamEvents(req, res); return; }
			void routes.dispatchAction(req, res);
		});

		const created = await (await fetch(`${base}/api/agent/sessions`, { method: "POST" })).json() as { sessionId: string };
		const controller = new AbortController();
		const response = await fetch(`${base}/api/agent/sessions/${created.sessionId}/events`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		const body = response.body;
		if (!body) throw new Error("expected a readable body");
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let received = "";
		async function readUntil(marker: string): Promise<void> {
			while (!received.includes(marker)) {
				const { value, done } = await reader.read();
				if (done) break;
				received += decoder.decode(value);
			}
		}

		// Converse: a real prompt dispatch through the daemon's own HTTP route -- the "user talks to Pi through Zodiac" half.
		const promptResponse = await fetch(`${base}/api/agent/sessions/${created.sessionId}/prompt`, { method: "POST", body: JSON.stringify({ text: "please run the tests" }) });
		expect(promptResponse.status).toBe(200);
		expect(integration.prompts).toEqual(["please run the tests"]);

		// Observe tool activity: a real tool-call round-trips through the SSE stream, start to end.
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "turn-start" });
		integration.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "bash", input: { command: "npm test" } });
		integration.emit({ type: "tool-call-update", toolCallId: "call_1", toolName: "bash", output: { partial: "..." } });
		integration.emit({ type: "tool-call-end", toolCallId: "call_1", toolName: "bash", output: { exitCode: 0 }, isError: false });
		integration.emit({ type: "assistant-message-end", text: "Tests passed." });
		integration.emit({ type: "turn-end" });
		integration.emit({ type: "agent-settled" });
		await readUntil("agent-settled");

		expect(received).toContain('data: {"type":"tool-call-start","toolCallId":"call_1","toolName":"bash","input":{"command":"npm test"}}');
		expect(received).toContain('data: {"type":"tool-call-update","toolCallId":"call_1","toolName":"bash","output":{"partial":"..."}}');
		expect(received).toContain('data: {"type":"tool-call-end","toolCallId":"call_1","toolName":"bash","output":{"exitCode":0},"isError":false}');
		expect(received).toContain('data: {"type":"assistant-message-end","text":"Tests passed."}');

		controller.abort();
	});
});
