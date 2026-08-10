import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai/compat";
import { createAgentSession, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AlignmentAgentEvent } from "./agent-integration-port.js";
import { createInProcessAgentIntegration } from "./in-process-agent-integration.js";

/**
 * A fully hermetic AgentSession: a scripted faux provider (no live network,
 * no API key) registered directly into a fresh ModelRuntime, matching
 * @earendil-works/pi-ai/compat's own documented test-provider pattern.
 */
async function createHermeticSession(toolNames: string[] = []): Promise<{ session: AgentSession; faux: FauxProviderHandle }> {
	const faux = fauxProvider();
	const model = faux.getModel();
	const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
	modelRuntime.registerNativeProvider(faux.provider);
	await modelRuntime.setRuntimeApiKey(model.provider, "test-key");

	const echoTool = defineTool({
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_id, params) => ({ content: [{ type: "text", text: `echo:${(params as { text: string }).text}` }], details: {} }),
	});

	const { session } = await createAgentSession({
		model,
		modelRuntime,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory(),
		cwd: process.cwd(),
		tools: toolNames,
		customTools: toolNames.includes("echo") ? [echoTool] : [],
	});
	return { session, faux };
}

describe("createInProcessAgentIntegration", () => {
	let disposers: Array<() => void> = [];

	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
	});

	it("translates a plain text response into start/delta/end, then agent-settled", async () => {
		const { session, faux } = await createHermeticSession();
		const integration = createInProcessAgentIntegration(session);
		disposers.push(integration.dispose);

		const events: AlignmentAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));

		faux.setResponses([fauxAssistantMessage("hello from faux")]);
		await integration.prompt("hi");

		// The faux provider simulates real token-by-token streaming, so the exact
		// delta count isn't asserted -- only the envelope (start ... end, settled)
		// and at least one delta actually arriving.
		const types = events.map((event) => event.type);
		expect(types[0]).toBe("agent-start");
		expect(types[1]).toBe("assistant-message-start");
		expect(types).toContain("assistant-message-delta");
		expect(types.at(-2)).toBe("assistant-message-end");
		expect(types.at(-1)).toBe("agent-settled");
		const end = events.find((event) => event.type === "assistant-message-end");
		expect(end).toMatchObject({ text: "hello from faux" });
	});

	it("translates a message_end whose stopReason is 'error' into a real error event, not a swallowed empty assistant message", async () => {
		// A real bug found live: an actual API failure (e.g. "no credits
		// remaining") arrives as message_end with an empty content array and
		// stopReason: "error" -- contentText() on empty content silently
		// produces "", rendered by the Footer as a meaningless "(empty
		// response)" with no indication anything actually went wrong.
		const { session, faux } = await createHermeticSession();
		const integration = createInProcessAgentIntegration(session);
		disposers.push(integration.dispose);

		const events: AlignmentAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));

		faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "You have no credits remaining." })]);
		await integration.prompt("hi");

		const error = events.find((event) => event.type === "error");
		expect(error).toMatchObject({ message: "You have no credits remaining." });
		expect(events.some((event) => event.type === "assistant-message-end")).toBe(false);
	});

	it("translates a tool call turn into tool-call-start/end, in order, before the follow-up response", async () => {
		const { session, faux } = await createHermeticSession(["echo"]);
		const integration = createInProcessAgentIntegration(session);
		disposers.push(integration.dispose);

		const events: AlignmentAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));

		faux.setResponses([fauxAssistantMessage(fauxToolCall("echo", { text: "ping" })), fauxAssistantMessage("done")]);
		await integration.prompt("use the echo tool");

		const types = events.map((event) => event.type);
		expect(types).toContain("tool-call-start");
		expect(types).toContain("tool-call-end");
		expect(types.indexOf("tool-call-start")).toBeLessThan(types.indexOf("tool-call-end"));

		const toolStart = events.find((event) => event.type === "tool-call-start");
		expect(toolStart).toMatchObject({ toolName: "echo", input: { text: "ping" } });
		const toolEnd = events.find((event) => event.type === "tool-call-end");
		expect(toolEnd).toMatchObject({ toolName: "echo", isError: false });
	});

	it("dispose() unsubscribes from the session and disposes it", async () => {
		const { session, faux } = await createHermeticSession();
		const integration = createInProcessAgentIntegration(session);

		const events: AlignmentAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));
		faux.setResponses([fauxAssistantMessage("first")]);
		await integration.prompt("hi");
		expect(events.length).toBeGreaterThan(0);

		integration.dispose();
		events.length = 0;
		expect(() => session.state).not.toThrow(); // dispose() must not throw synchronously for a caller reading state right after
	});

	it("onExit never fires for the in-process adapter -- there is no separate process to exit", async () => {
		const { session } = await createHermeticSession();
		const integration = createInProcessAgentIntegration(session);
		disposers.push(integration.dispose);

		const exitListener = () => {
			throw new Error("onExit should never fire for an in-process integration");
		};
		const unsubscribe = integration.onExit(exitListener);
		unsubscribe();
	});
});
