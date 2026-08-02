/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import type { ConversationItem } from "./projector.js";
import { ConversationSurface } from "./ConversationSurface.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

/**
 * Named fixtures for every state ConversationSurface can render -- one per
 * ConversationItem kind, plus the loading/error/empty transport states.
 * Each is asserted directly at the component level instead of only being
 * incidentally exercised by whichever single state an e2e flow happens to
 * pass through.
 */
const FIXTURES = {
	loading: { items: [] as ConversationItem[], loading: true, error: undefined },
	error: { items: [] as ConversationItem[], loading: false, error: "Conversation unavailable (boom)." },
	empty: { items: [] as ConversationItem[], loading: false, error: undefined },
	userMessage: { items: [{ kind: "message", role: "user", text: "Run the tests", timestamp: 1 }] as ConversationItem[], loading: false, error: undefined },
	assistantMessage: { items: [{ kind: "message", role: "assistant", text: "Done.", timestamp: 2 }] as ConversationItem[], loading: false, error: undefined },
	turnMarker: { items: [{ kind: "turn-marker", toolCallCount: 3, timestamp: 3 }] as ConversationItem[], loading: false, error: undefined },
	toolCall: { items: [{ kind: "tool-call", toolCallId: "t1", toolName: "read", request: { path: "a.ts" }, response: { content: "ok" }, timestamp: 4 }] as ConversationItem[], loading: false, error: undefined },
	fallback: { items: [{ kind: "fallback", bus: "internal", type: "session.name", payload: {}, timestamp: 5 }] as ConversationItem[], loading: false, error: undefined },
} satisfies Record<string, { items: ConversationItem[]; loading: boolean; error?: string }>;

function renderSurface(fixture: (typeof FIXTURES)[keyof typeof FIXTURES]) {
	const registry = createCommandRegistry({
		commands: [{ id: "conversation.send", title: "Send message", description: "Sends the drafted message.", execute: vi.fn() }],
		bindings: [],
	});
	return render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<ConversationSurface items={fixture.items} loading={fixture.loading} error={fixture.error} draft="" onDraftChange={vi.fn()} onComposerFocus={vi.fn()} />
		</CommandProvider>,
	);
}

describe("ConversationSurface", () => {
	it("shows a loading state before any events arrive", () => {
		renderSurface(FIXTURES.loading);
		expect(screen.getByText(/loading conversation/i)).toBeInTheDocument();
	});

	it("shows the transport error message instead of the transcript", () => {
		renderSurface(FIXTURES.error);
		expect(screen.getByText(FIXTURES.error.error)).toBeInTheDocument();
	});

	it("shows an explicit empty state, not a blank pane, when there are no renderable events", () => {
		renderSurface(FIXTURES.empty);
		expect(screen.getByText(/no renderable events/i)).toBeInTheDocument();
	});

	it("renders a user message aligned as the user's own turn", () => {
		renderSurface(FIXTURES.userMessage);
		expect(screen.getByText("Run the tests")).toBeInTheDocument();
		expect(screen.getByText("User:")).toBeInTheDocument();
	});

	it("renders an assistant message attributed to Alef", () => {
		renderSurface(FIXTURES.assistantMessage);
		expect(screen.getByText("Done.")).toBeInTheDocument();
		expect(screen.getByText("Alef:")).toBeInTheDocument();
	});

	it("renders a collapsed turn marker with the tool call count", () => {
		renderSurface(FIXTURES.turnMarker);
		expect(screen.getByText(/used 3 tools/i)).toBeInTheDocument();
	});

	it("renders a tool call as a disclosure with its request and response payloads", () => {
		renderSurface(FIXTURES.toolCall);
		expect(screen.getByText("read")).toBeInTheDocument();
		expect(screen.getByText("Request")).toBeInTheDocument();
		expect(screen.getByText(/"path": "a.ts"/)).toBeInTheDocument();
	});

	it("renders an unrecognized event through the generic fallback row instead of dropping it", () => {
		renderSurface(FIXTURES.fallback);
		expect(screen.getByText("internal/session.name")).toBeInTheDocument();
	});

	describe("Composer", () => {
		it("spans edge-to-edge of its own container, not inset by a separate max-w-3xl", () => {
			renderSurface(FIXTURES.empty);
			const input = screen.getByLabelText("Message Alef");
			const row = input.parentElement as HTMLElement;
			expect(row.className).not.toContain("max-w-3xl");
			expect(row.className).not.toContain("mx-auto");
		});

		it("the send button's height tracks the composer row instead of a fixed square", () => {
			renderSurface(FIXTURES.empty);
			const button = screen.getByRole("button", { name: "Send message" });
			expect(button.className).not.toContain("size-9");
			expect(button.className).toContain("self-stretch");
		});
	});
});
