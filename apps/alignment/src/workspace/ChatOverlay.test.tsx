/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import type { ConversationItem } from "../conversation/projector.js";
import { ChatOverlay } from "./ChatOverlay.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderOverlay(visible: boolean, items: readonly ConversationItem[] = []) {
	const registry = createCommandRegistry({
		commands: [{ id: "conversation.send", title: "Send message", description: "Sends the drafted message.", execute: vi.fn() }],
		bindings: [],
	});
	return render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<ChatOverlay
				visible={visible}
				onPointerEnter={vi.fn()}
				onPointerLeave={vi.fn()}
				onFocusCapture={vi.fn()}
				onBlurCapture={vi.fn()}
				conversationItems={items}
				conversationLoading={false}
				conversationError={undefined}
				draft=""
				onDraftChange={vi.fn()}
				onComposerFocus={vi.fn()}
				onDock={vi.fn()}
			/>
		</CommandProvider>,
	);
}

const MESSAGES: ConversationItem[] = [
	{ kind: "message", role: "user", text: "First message", timestamp: 1 },
	{ kind: "message", role: "assistant", text: "Most recent reply", timestamp: 2 },
];

describe("ChatOverlay", () => {
	it("is inert and aria-hidden while not visible, so it can never take keyboard focus", () => {
		renderOverlay(false);
		const dialog = screen.getByRole("dialog", { hidden: true });
		expect(dialog).toHaveAttribute("aria-hidden", "true");
		expect(dialog).toHaveAttribute("inert");
	});

	it("is focusable and not aria-hidden once visible", () => {
		renderOverlay(true);
		const dialog = screen.getByRole("dialog");
		expect(dialog).not.toHaveAttribute("aria-hidden", "true");
		expect(dialog).not.toHaveAttribute("inert");
	});

	it("starts collapsed (peek): shows only the composer and the most recent reply, not the full transcript", () => {
		renderOverlay(true, MESSAGES);
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		expect(screen.getByLabelText("Message Alef")).toBeInTheDocument();
	});

	it("peek shows a placeholder when there are no messages yet", () => {
		renderOverlay(true, []);
		expect(screen.getByText("No messages yet.")).toBeInTheDocument();
	});

	it("clicking the peek area expands to the full transcript, revealing earlier messages", () => {
		renderOverlay(true, MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));

		expect(screen.getByText("First message")).toBeInTheDocument();
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
		expect(screen.getByRole("log", { name: "AI conversation" })).toBeInTheDocument();
	});

	it("the collapse control returns from expanded back to peek", () => {
		renderOverlay(true, MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));
		fireEvent.click(screen.getByRole("button", { name: "Collapse to the last reply" }));

		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
	});
});
