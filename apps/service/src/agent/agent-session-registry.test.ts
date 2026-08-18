import { describe, expect, it, vi } from "vitest";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { createAgentSessionRegistry } from "./agent-session-registry.js";

function fakeIntegration(): AgentIntegrationPort & { emit(event: ZodiacAgentEvent): void; emitExit(reason: string | undefined): void } {
	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	const exitListeners = new Set<(reason: string | undefined) => void>();
	return {
		prompt: vi.fn(async () => {}),
		steer: vi.fn(async () => {}),
		followUp: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		onEvent: (listener) => {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		dispose: vi.fn(),
		emit(event) {
			for (const listener of eventListeners) listener(event);
		},
		emitExit(reason) {
			for (const listener of exitListeners) listener(reason);
		},
	};
}

describe("createAgentSessionRegistry", () => {
	it("create() returns a fresh sessionId each time, backed by a freshly constructed integration", async () => {
		const create = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(create);

		const a = await registry.create();
		const b = await registry.create();
		expect(a).not.toBe(b);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("forwards a client-requested cwd and initialActiveToolNames to the integration factory, undefined when none was given", async () => {
		const create = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(create);

		await registry.create("/repos/pipes");
		expect(create).toHaveBeenCalledWith("/repos/pipes", undefined, undefined);
		await registry.create();
		expect(create).toHaveBeenCalledWith(undefined, undefined, undefined);
	});

	it("forwards a caller-resolved initialActiveToolNames to the integration factory unchanged", async () => {
		const create = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(create);

		await registry.create(undefined, []);
		expect(create).toHaveBeenCalledWith(undefined, [], undefined);
	});

	it("forwards a caller-resolved workspaceId to the integration factory unchanged", async () => {
		const create = vi.fn(() => fakeIntegration());
		const registry = createAgentSessionRegistry(create);

		await registry.create(undefined, undefined, "ws-1" as never);
		expect(create).toHaveBeenCalledWith(undefined, undefined, "ws-1");
	});

	it("awaits an async integration factory (the real production shape) before registering the session", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return integration;
		});

		const id = await registry.create();
		expect(registry.get(id)).toBe(integration);
	});

	it("get() resolves a live session by id; an unknown id is undefined", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const id = await registry.create();
		expect(registry.get(id)).toBeDefined();
		expect(registry.get("nope")).toBeUndefined();
	});

	it("list() reports every live session's id and createdAt", async () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		const id = await registry.create();
		const sessions = registry.list();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.sessionId).toBe(id);
		expect(typeof sessions[0]?.createdAt).toBe("number");
	});

	it("history() accumulates every event a session's integration ever emits, in order", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const id = await registry.create();

		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-end", text: "hi" });

		expect(registry.history(id)).toEqual([{ type: "agent-start" }, { type: "assistant-message-end", text: "hi" }]);
	});

	it("history() for an unknown session is an empty array, not an error", () => {
		const registry = createAgentSessionRegistry(() => fakeIntegration());
		expect(registry.history("nope")).toEqual([]);
	});

	it("remove() disposes the integration and drops it from the registry", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const id = await registry.create();

		registry.remove(id);
		expect(integration.dispose).toHaveBeenCalledOnce();
		expect(registry.get(id)).toBeUndefined();
	});

	it("a session that exits on its own (onExit fires) is dropped from the registry, mirroring the subprocess adapter's own crash path", async () => {
		const integration = fakeIntegration();
		const registry = createAgentSessionRegistry(() => integration);
		const id = await registry.create();

		integration.emitExit("process exited");
		expect(registry.get(id)).toBeUndefined();
	});
});
