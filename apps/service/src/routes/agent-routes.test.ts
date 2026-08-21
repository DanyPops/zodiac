import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { workspaceId } from "@zodiac/protocol";
import { createPendingClientActions } from "@zodiac/server/agent";
import { createAgentSessionRegistry } from "../agent/agent-session-registry.js";
import { createAgentRoutes } from "./agent-routes.js";

function fakeIntegration(): AgentIntegrationPort & { emit(event: ZodiacAgentEvent): void } {
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	return {
		prompt: vi.fn(async () => {}),
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

describe("createAgentRoutes", () => {
	it("createSession returns a fresh sessionId backed by the registry", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions`, { method: "POST" });
		const body = (await response.json()) as { sessionId: string };
		expect(response.status).toBe(200);
		expect(registry.get(body.sessionId)).toBeDefined();
	});

	it("createSession returns 500 instead of crashing when construction fails (e.g. no model configured)", async () => {
		const registry = createAgentSessionRegistry(() => {
			throw new Error("no model configured");
		});
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions`, { method: "POST" });
		expect(response.status).toBe(500);
	});

	it("createSession resolves a requested workspaceId through getWorkspaceToolIds, never a client-supplied tool list", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const getWorkspaceToolIds = vi.fn(() => ["lector.fs"]);
		const routes = createAgentRoutes(registry, getWorkspaceToolIds);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST", body: JSON.stringify({ workspaceId: "ws", tools: ["edit", "write", "bash"] }) });

		expect(getWorkspaceToolIds).toHaveBeenCalledWith(workspaceId("ws"));
		expect(createIntegration).toHaveBeenCalledWith(undefined, ["lector.fs"], workspaceId("ws"));
	});

	it("createSession omits initialActiveToolNames when no workspaceId is requested -- preserves the factory's own default", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const getWorkspaceToolIds = vi.fn(() => ["lector.fs"]);
		const routes = createAgentRoutes(registry, getWorkspaceToolIds);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST" });

		expect(getWorkspaceToolIds).not.toHaveBeenCalled();
		expect(createIntegration).toHaveBeenCalledWith(undefined, undefined, undefined);
	});

	it("createSession forwards the raw workspaceId to the integration factory even when getWorkspaceToolIds is unavailable -- it's a separate concern from the tool-list resolution", async () => {
		const createIntegration = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(createIntegration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.createSession(req, res);
		});

		await fetch(`${base}/api/agent/sessions`, { method: "POST", body: JSON.stringify({ workspaceId: "ws" }) });

		expect(createIntegration).toHaveBeenCalledWith(undefined, undefined, workspaceId("ws"));
	});

	it("listSessions reports every live session", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.listSessions(req, res);
		});
		const id = await registry.create();

		const response = await fetch(`${base}/api/agent/sessions`);
		const body = (await response.json()) as { sessions: { sessionId: string }[] };
		expect(response.status).toBe(200);
		expect(body.sessions.map((s) => s.sessionId)).toEqual([id]);
	});

	it("prompt/steer/followUp/abort forward to the right session's integration, and 404 for an unknown one", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.dispatchAction(req, res);
		});
		const id = await registry.create();

		const prompt = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: JSON.stringify({ text: "hello" }) });
		expect(prompt.status).toBe(200);
		expect(integration.prompt).toHaveBeenCalledWith("hello");

		const steer = await fetch(`${base}/api/agent/sessions/${id}/steer`, { method: "POST", body: JSON.stringify({ text: "steer text" }) });
		expect(steer.status).toBe(200);
		expect(integration.steer).toHaveBeenCalledWith("steer text");

		const followUp = await fetch(`${base}/api/agent/sessions/${id}/followUp`, { method: "POST", body: JSON.stringify({ text: "follow up" }) });
		expect(followUp.status).toBe(200);
		expect(integration.followUp).toHaveBeenCalledWith("follow up");

		const abort = await fetch(`${base}/api/agent/sessions/${id}/abort`, { method: "POST" });
		expect(abort.status).toBe(200);
		expect(integration.abort).toHaveBeenCalledOnce();

		const unknown = await fetch(`${base}/api/agent/sessions/nope/prompt`, { method: "POST", body: JSON.stringify({ text: "hi" }) });
		expect(unknown.status).toBe(404);
	});

	it("forwards model, compaction, resume, and fork controls with validated payloads", async () => {
		const integration = fakeIntegration();
		const controls = {
			setModel: vi.fn(async () => ({ ok: true } as const)),
			compact: vi.fn(async () => ({ ok: true } as const)),
			resume: vi.fn(async () => ({ ok: true } as const)),
			fork: vi.fn(async () => ({ ok: true } as const)),
		};
		Object.assign(integration, { session: controls });
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => void routes.dispatchAction(req, res));
		const id = await registry.create();

		await fetch(`${base}/api/agent/sessions/${id}/setModel`, { method: "POST", body: JSON.stringify({ provider: "anthropic", modelId: "sonnet" }) });
		await fetch(`${base}/api/agent/sessions/${id}/compact`, { method: "POST", body: JSON.stringify({ customInstructions: "focus" }) });
		await fetch(`${base}/api/agent/sessions/${id}/resume`, { method: "POST", body: JSON.stringify({ sessionPath: "/tmp/session.jsonl" }) });
		await fetch(`${base}/api/agent/sessions/${id}/fork`, { method: "POST", body: JSON.stringify({ entryId: "entry-1" }) });

		expect(controls.setModel).toHaveBeenCalledWith("anthropic", "sonnet");
		expect(controls.compact).toHaveBeenCalledWith("focus");
		expect(controls.resume).toHaveBeenCalledWith("/tmp/session.jsonl");
		expect(controls.fork).toHaveBeenCalledWith("entry-1");
	});

	it("prompt rejects a missing or empty text", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.dispatchAction(req, res);
		});
		const id = await registry.create();

		const missing = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: "{}" });
		expect(missing.status).toBe(400);

		const empty = await fetch(`${base}/api/agent/sessions/${id}/prompt`, { method: "POST", body: JSON.stringify({ text: "   " }) });
		expect(empty.status).toBe(400);
	});

	it("streamEvents replays accumulated history to a newly-attaching subscriber, then tails live events", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.streamEvents(req, res);
		});
		const id = await registry.create();

		// Emitted before any subscriber ever connects -- the exact "late
		// joiner" scenario the replay-then-tail requirement exists for.
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-end", text: "hi" });

		const controller = new AbortController();
		const response = await fetch(`${base}/api/agent/sessions/${id}/events`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const decoder = new TextDecoder();

		let received = "";
		while (!received.includes("assistant-message-end")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value);
		}
		expect(received).toContain('data: {"type":"agent-start"}');
		expect(received).toContain('data: {"type":"assistant-message-end","text":"hi"}');

		integration.emit({ type: "agent-settled" });
		while (!received.includes("agent-settled")) {
			const { value, done } = await reader.read();
			if (done) break;
			received += decoder.decode(value);
		}
		expect(received).toContain('data: {"type":"agent-settled"}');

		controller.abort();
	});

	it("streamEvents 404s for an unknown session", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const routes = createAgentRoutes(registry);
		const base = await listen((req, res) => {
			void routes.streamEvents(req, res);
		});

		const response = await fetch(`${base}/api/agent/sessions/nope/events`);
		expect(response.status).toBe(404);
	});

	/**
	 * Grounded in anomalyco/opencode issue #16697's own forensics ("Memory leak forensics: 187GB
	 * RSS, SSE AsyncQueue as root cause") -- see world-routes.test.ts's own equivalent test for the
	 * full rationale (raw non-reading socket, res.cork() for deterministic accumulation independent
	 * of OS buffer sizing, an actively-draining second client proving per-connection isolation).
	 * Individual ZodiacAgentEvents are fixed-size and independent of each other, matching
	 * notification-routes.test.ts's own shape rather than world-routes.test.ts's cumulative one.
	 */
	it("streamEvents (live tail) destroys a connection whose own buffered bytes exceed the configured cap, and never touches any other connected client", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const maxSseBufferedBytes = 300_000;
		const routes = createAgentRoutes(registry, undefined, undefined, { maxSseBufferedBytes });
		let capturedRes: import("node:http").ServerResponse | undefined;
		const base = await listen((req, res) => {
			if (!capturedRes) {
				capturedRes = res;
				res.cork(); // never uncorked -- see world-routes.test.ts's own doc comment
			}
			void routes.streamEvents(req, res);
		});
		const id = await registry.create();
		const url = new URL(base);

		const slowSocket = connect({ host: url.hostname, port: Number(url.port) });
		await new Promise<void>((resolve, reject) => {
			slowSocket.once("connect", () => resolve());
			slowSocket.once("error", reject);
		});
		slowSocket.write(`GET /api/agent/sessions/${id}/events HTTP/1.1\r\nHost: ${url.host}\r\nConnection: keep-alive\r\n\r\n`);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const healthyController = new AbortController();
		const healthyResponse = await fetch(`${base}/api/agent/sessions/${id}/events`, { signal: healthyController.signal });
		const healthyReader = healthyResponse.body?.getReader();
		if (!healthyReader) throw new Error("expected a readable body");

		// 15 independent, fixed-size (~60KB) assistant-message-end events -- comfortably exceeds the
		// 300KB cap for the never-draining slow client, never once for the actively-draining healthy
		// one. tool-call-end's own unknown-typed output is the real, concrete unbounded-payload risk
		// named in this Task's own body (a tool call can legitimately return megabytes, e.g. a large
		// file read) -- this event type exercises that same size class directly.
		const bigText = "x".repeat(60_000);
		for (let index = 0; index < 15; index += 1) {
			integration.emit({ type: "assistant-message-end", text: bigText });
			await healthyReader.read();
		}

		expect(capturedRes?.destroyed).toBe(true);

		integration.emit({ type: "error", message: "after-destroy" });
		const decoder = new TextDecoder();
		let received = "";
		while (!received.includes("after-destroy")) {
			const next = await healthyReader.read();
			if (next.done) throw new Error("healthy client's own stream ended unexpectedly");
			received += decoder.decode(next.value);
		}
		expect(received).toContain("after-destroy");

		healthyController.abort();
		slowSocket.destroy();
	});

	/**
	 * The replay-then-tail path's own history loop (registry.history(sessionId), written before a
	 * live subscription even exists) is a real, distinct write site from the live tail above --
	 * proves it independently rather than assuming the same guard covers both by construction.
	 */
	it("streamEvents (history replay) stops replaying once a late-attaching client's own buffered bytes exceed the configured cap", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const id = await registry.create();
		// All emitted before any subscriber connects -- accumulated into the session's own history,
		// replayed synchronously to the very first attaching client in one tight loop.
		const bigText = "x".repeat(60_000);
		for (let index = 0; index < 15; index += 1) {
			integration.emit({ type: "assistant-message-end", text: bigText });
		}

		const maxSseBufferedBytes = 300_000;
		const routes = createAgentRoutes(registry, undefined, undefined, { maxSseBufferedBytes });
		let capturedRes: import("node:http").ServerResponse | undefined;
		const base = await listen((req, res) => {
			if (!capturedRes) {
				capturedRes = res;
				// The whole point here: the replay loop itself is a single, tight, synchronous burst
				// against ONE connection -- no separate "healthy" comparison is needed the way the live
				// tail test above needs one, since a real client reading at a real pace would drain
				// each frame across real, separate ticks; corking isolates and proves the loop itself
				// still respects the same per-write cap check, deterministically.
				res.cork();
			}
			void routes.streamEvents(req, res);
		});

		// Corked from before even the response headers are flushed, so a genuinely destroyed
		// connection here means fetch() itself never receives a valid HTTP response at all -- a
		// real, legitimate outcome for a peer that closes before delivering anything, not a bug in
		// this test's own expectations.
		await expect(fetch(`${base}/api/agent/sessions/${id}/events`)).rejects.toThrow();
		expect(capturedRes?.destroyed).toBe(true);
	});

	describe("postClientAction", () => {
		it("delivers a POSTed result to the matching PendingClientActions registration", async () => {
			const registry = createAgentSessionRegistry(() => fakeIntegration());
			const pendingClientActions = createPendingClientActions();
			const routes = createAgentRoutes(registry, undefined, pendingClientActions);
			const base = await listen((req, res) => {
				void routes.postClientAction(req, res);
			});

			const pending = pendingClientActions.register("call-1", 2_000);
			const response = await fetch(`${base}/api/agent/sessions/sess-1/client-actions/call-1`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ result: { cues: [{ id: "a" }] } }),
			});
			expect(response.ok).toBe(true);
			expect(await response.json()).toEqual({ delivered: true });
			await expect(pending).resolves.toEqual({ cues: [{ id: "a" }] });
		});

		it("reports delivered: false for a toolCallId nothing is pending under -- a late/duplicate POST, never a 500", async () => {
			const registry = createAgentSessionRegistry(() => fakeIntegration());
			const pendingClientActions = createPendingClientActions();
			const routes = createAgentRoutes(registry, undefined, pendingClientActions);
			const base = await listen((req, res) => {
				void routes.postClientAction(req, res);
			});

			const response = await fetch(`${base}/api/agent/sessions/sess-1/client-actions/never-registered`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ result: {} }),
			});
			expect(response.ok).toBe(true);
			expect(await response.json()).toEqual({ delivered: false });
		});

		it("404s when no PendingClientActions was ever given to createAgentRoutes", async () => {
			const registry = createAgentSessionRegistry(() => fakeIntegration());
			const routes = createAgentRoutes(registry);
			const base = await listen((req, res) => {
				void routes.postClientAction(req, res);
			});

			const response = await fetch(`${base}/api/agent/sessions/sess-1/client-actions/call-1`, { method: "POST", body: "{}" });
			expect(response.status).toBe(404);
		});
	});
});
