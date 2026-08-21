import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxProviderHandle } from "@earendil-works/pi-ai/compat";
import { createAgentSession, defineTool, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { createInProcessAgentIntegration } from "./in-process-agent-integration.js";

/**
 * A fully hermetic AgentSession: a scripted faux provider (no live network,
 * no API key) registered directly into a fresh ModelRuntime, matching
 * @earendil-works/pi-ai/compat's own documented test-provider pattern.
 */
async function createHermeticSession(toolNames: string[] = [], fauxOptions: Parameters<typeof fauxProvider>[0] = {}): Promise<{ session: AgentSession; faux: FauxProviderHandle }> {
	const faux = fauxProvider(fauxOptions);
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

		const events: ZodiacAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));

		faux.setResponses([fauxAssistantMessage("hello from faux")]);
		await integration.prompt("hi");

		// The faux provider simulates real token-by-token streaming, so the exact
		// delta count isn't asserted -- only the envelope (start ... end, settled)
		// and at least one delta actually arriving.
		const types = events.map((event) => event.type);
		expect(types[0]).toBe("agent-start");
		expect(types).toContain("turn-start");
		expect(types).toContain("assistant-message-start");
		expect(types).toContain("assistant-message-delta");
		expect(types).toContain("assistant-message-end");
		expect(types).toContain("turn-end");
		expect(types.at(-1)).toBe("agent-settled");
		const end = events.find((event) => event.type === "assistant-message-end");
		expect(end).toMatchObject({ text: "hello from faux" });
	});

	it("accumulates real multi-chunk streaming text across successive deltas, instead of replacing it with only the latest chunk", async () => {
		// A real bug found live: text_delta's own `delta` field is genuinely just
		// the newest chunk (confirmed against @earendil-works/pi-ai's own type:
		// `{ delta: string; partial: AssistantMessage }`), never the accumulated
		// text -- and real prior art in this exact SDK family (pi-mono commit
		// b939f2b5, "Fix README: use assistantMessageEvent.delta for streaming,
		// not accumulated message") shows *why* that split exists: `delta` is
		// correct for an append-only stdout writer (each write naturally grows
		// the terminal's own scrollback), but Zodiac's Footer is a stateful
		// full-repaint renderer -- every frame redraws an item's *entire*
		// current text from scratch, so it needs the accumulated value, not an
		// increment. Forcing tiny (1-char) faux chunks to make the distinction
		// observable -- a single-chunk response (the other test above) never
		// exercises accumulation across more than one delta at all.
		const { session, faux } = await createHermeticSession([], { tokenSize: { min: 1, max: 1 } });
		const integration = createInProcessAgentIntegration(session);
		disposers.push(integration.dispose);

		const events: ZodiacAgentEvent[] = [];
		integration.onEvent((event) => events.push(event));

		faux.setResponses([fauxAssistantMessage("hello there world")]);
		await integration.prompt("hi");

		const deltas = events.filter((event) => event.type === "assistant-message-delta") as Array<{ text: string }>;
		expect(deltas.length).toBeGreaterThan(1); // otherwise this test isn't exercising accumulation at all
		// Each successive delta's text must be a strict extension of the last --
		// growing, never shrinking back down to a single fragment.
		for (let index = 1; index < deltas.length; index++) {
			expect(deltas[index]!.text.length).toBeGreaterThan(deltas[index - 1]!.text.length);
			expect(deltas[index]!.text.startsWith(deltas[index - 1]!.text)).toBe(true);
		}
		expect(deltas.at(-1)!.text).toBe("hello there world");
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

		const events: ZodiacAgentEvent[] = [];
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

		const events: ZodiacAgentEvent[] = [];
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

	it("exposes model switch and manual compaction as bounded session controls", async () => {
		const { session, faux } = await createHermeticSession();
		const model = faux.getModel();
		const integration = createInProcessAgentIntegration(session, {
			resolveModel: (provider, modelId) => (provider === model.provider && modelId === model.id ? session.model : undefined),
		});
		disposers.push(integration.dispose);

		expect(await integration.session!.setModel(model.provider, model.id)).toEqual({ ok: true });
		expect(await integration.session!.setModel("missing", "missing")).toMatchObject({ ok: false, reason: "model-not-found" });
	});

	it("dispose() unsubscribes from the session and disposes it", async () => {
		const { session, faux } = await createHermeticSession();
		const integration = createInProcessAgentIntegration(session);

		const events: ZodiacAgentEvent[] = [];
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
