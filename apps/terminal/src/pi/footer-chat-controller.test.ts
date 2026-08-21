import { describe, expect, it, vi } from "vitest";
import type { AgentIntegrationPort, ZodiacAgentEvent } from "@zodiac/agent";
import { createFooterChatController } from "./footer-chat-controller.js";

function fakeIntegration(): AgentIntegrationPort & { emit(event: ZodiacAgentEvent): void; exit(reason: string | undefined): void } {
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
		exit(reason) {
			for (const listener of exitListeners) listener(reason);
		},
	};
}

describe("createFooterChatController", () => {
	it("starts in composing state with an empty draft and no history", () => {
		const controller = createFooterChatController(fakeIntegration());
		expect(controller.snapshot()).toEqual({ kind: "composing", draft: "", items: [] });
	});

	it("builds up a draft one character at a time, and backspace removes the last one", () => {
		const controller = createFooterChatController(fakeIntegration());
		controller.typeChar("h");
		controller.typeChar("i");
		expect(controller.snapshot()).toMatchObject({ kind: "composing", draft: "hi" });
		controller.backspace();
		expect(controller.snapshot()).toMatchObject({ kind: "composing", draft: "h" });
	});

	it("backspace on an empty draft is a no-op, not a negative-length string", () => {
		const controller = createFooterChatController(fakeIntegration());
		controller.backspace();
		expect(controller.snapshot()).toMatchObject({ draft: "" });
	});

	it("submit() sends the trimmed draft, clears it immediately, and appends the user's own message to history", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		controller.typeChar("h");
		controller.typeChar("i");
		controller.submit();
		expect(integration.prompt).toHaveBeenCalledWith("hi");
		expect(controller.snapshot()).toMatchObject({ draft: "", items: [{ role: "user", text: "hi" }] });
	});

	it("submit() on an empty or whitespace-only draft does not call prompt() or add a history item", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		controller.typeChar(" ");
		controller.submit();
		expect(integration.prompt).not.toHaveBeenCalled();
		expect(controller.snapshot()).toMatchObject({ items: [] });
	});

	it("tracks busy across agent-start/agent-settled", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		expect(controller.snapshot().kind).toBe("busy");
		integration.emit({ type: "agent-settled" });
		// No text ever arrived this turn -- "composing" (nothing to show), not a
		// misleading "idle" implying a completed response exists.
		expect(controller.snapshot().kind).toBe("composing");
	});

	it("surfaces turn, compaction, and session metadata from the shared event vocabulary", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "turn-start" });
		expect(controller.snapshot().activity).toBe("turn");
		integration.emit({ type: "turn-end" });
		expect(controller.snapshot().activity).toBeUndefined();
		integration.emit({ type: "compaction-start", reason: "manual" });
		expect(controller.snapshot()).toMatchObject({ kind: "busy", activity: "compaction" });
		integration.emit({ type: "session-info-changed", name: "Cluster A" });
		expect(controller.snapshot().sessionName).toBe("Cluster A");
		integration.emit({ type: "compaction-end", reason: "manual", aborted: false });
		expect(controller.snapshot().activity).toBeUndefined();
	});

	it("live-updates a single streaming assistant item, then finalizes it -- not a new item per delta", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-start" });
		integration.emit({ type: "assistant-message-delta", text: "Hel" });
		expect(controller.snapshot()).toMatchObject({ kind: "busy", items: [{ role: "assistant", text: "Hel" }] });

		integration.emit({ type: "assistant-message-delta", text: "Hello" });
		expect(controller.snapshot()).toMatchObject({ items: [{ role: "assistant", text: "Hello" }] });

		integration.emit({ type: "assistant-message-end", text: "Hello!" });
		integration.emit({ type: "agent-settled" });
		expect(controller.snapshot()).toEqual({ kind: "idle", draft: "", items: [{ role: "assistant", text: "Hello!" }] });
	});

	it("a turn that settles with no visible text still surfaces as a real item, not silently dropped", () => {
		// A real live smoke test against this exact controller found this gap:
		// an assistant turn resolving with empty content (an error stopReason,
		// empty content, ...) produced a false-looking \"composing\" state --
		// indistinguishable from \"the user never sent anything\".
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-start" });
		integration.emit({ type: "assistant-message-end", text: "" });
		integration.emit({ type: "agent-settled" });
		expect(controller.snapshot()).toEqual({ kind: "idle", draft: "", items: [{ role: "assistant", text: "(empty response)" }] });
	});

	it("a full round trip accumulates a real, ordered conversation history: user, tool, assistant", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		controller.typeChar("h");
		controller.submit();
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "tool-call-start", toolCallId: "1", toolName: "bash", input: {} });
		integration.emit({ type: "tool-call-end", toolCallId: "1", toolName: "bash", output: {}, isError: false });
		integration.emit({ type: "assistant-message-start" });
		integration.emit({ type: "assistant-message-end", text: "done" });
		integration.emit({ type: "agent-settled" });

		expect(controller.snapshot().items).toEqual([
			{ role: "user", text: "h" },
			{ role: "tool", text: "bash", status: "success" },
			{ role: "assistant", text: "done" },
		]);
	});

	it("a tool item carries its own status (pending/success/error) as data, not baked into its text -- matching Pi TUI's own tool-execution model, where status drives a background-color state (pending/success/error), not inline text", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "bash", input: {} });
		expect(controller.snapshot().items).toEqual([{ role: "tool", text: "bash", status: "pending" }]);
	});

	it("updates the same tool item in place on tool-call-end, rather than appending a second one", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "bash", input: {} });
		expect(controller.snapshot().items).toEqual([{ role: "tool", text: "bash", status: "pending" }]);

		integration.emit({ type: "tool-call-end", toolCallId: "call_1", toolName: "bash", output: { output: "ok" }, isError: false });
		expect(controller.snapshot().items).toEqual([{ role: "tool", text: "bash", status: "success" }]);
	});

	it("a failed tool call is marked distinctly from a succeeded one", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "tool-call-start", toolCallId: "call_1", toolName: "bash", input: {} });
		integration.emit({ type: "tool-call-end", toolCallId: "call_1", toolName: "bash", output: {}, isError: true });
		expect(controller.snapshot().items).toEqual([{ role: "tool", text: "bash", status: "error" }]);
	});

	it("submit() resets error and starts a fresh streaming slot so a new turn's busy state never shows stale content", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-end", text: "first answer" });
		integration.emit({ type: "agent-settled" });
		expect(controller.snapshot()).toMatchObject({ kind: "idle", items: [{ role: "assistant", text: "first answer" }] });

		controller.typeChar("h");
		controller.submit();
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "assistant-message-start" });
		integration.emit({ type: "assistant-message-delta", text: "second" });
		// A new streaming slot, not an in-place overwrite of "first answer".
		expect(controller.snapshot().items).toEqual([
			{ role: "assistant", text: "first answer" },
			{ role: "user", text: "h" },
			{ role: "assistant", text: "second" },
		]);
	});

	it("bounds history at MAX_ITEMS, dropping the oldest first", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		for (let i = 0; i < 250; i++) {
			controller.typeChar(String(i));
			controller.submit();
		}
		const items = controller.snapshot().items;
		expect(items.length).toBe(200);
		expect(items[0]).toEqual({ role: "user", text: "50" });
		expect(items.at(-1)).toEqual({ role: "user", text: "249" });
	});

	it("surfaces an error event and clears busy", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.emit({ type: "agent-start" });
		integration.emit({ type: "error", message: "no model configured" });
		expect(controller.snapshot()).toEqual({ kind: "error", draft: "", message: "no model configured", items: [] });
	});

	it("a subprocess integration's onExit surfaces as an error", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.exit("pi exited with code 1");
		expect(controller.snapshot()).toEqual({ kind: "error", draft: "", message: "pi exited with code 1", items: [] });
	});

	it("a clean exit (no reason) does not surface as an error", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		integration.exit(undefined);
		expect(controller.snapshot()).toEqual({ kind: "composing", draft: "", items: [] });
	});

	it("submit() failing surfaces as an error", async () => {
		const integration = fakeIntegration();
		(integration.prompt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("spawn failed"));
		const controller = createFooterChatController(integration);
		controller.typeChar("h");
		controller.submit();
		await vi.waitFor(() => expect(controller.snapshot()).toMatchObject({ kind: "error", message: "spawn failed" }));
	});

	it("forwards session controls through the same AgentIntegrationPort", async () => {
		const integration = fakeIntegration();
		const setModel = vi.fn(async () => ({ ok: true } as const));
		Object.assign(integration, {
			session: {
				setModel,
				compact: vi.fn(async () => ({ ok: true } as const)),
				resume: vi.fn(async () => ({ ok: true } as const)),
				fork: vi.fn(async () => ({ ok: true } as const)),
			},
		});
		const controller = createFooterChatController(integration);
		expect(await controller.setModel("anthropic", "sonnet")).toEqual({ ok: true });
		expect(setModel).toHaveBeenCalledWith("anthropic", "sonnet");
	});

	it("dispose() unsubscribes from both event and exit streams", () => {
		const integration = fakeIntegration();
		const controller = createFooterChatController(integration);
		controller.dispose();
		integration.emit({ type: "agent-start" });
		expect(controller.snapshot().kind).toBe("composing");
	});
});
