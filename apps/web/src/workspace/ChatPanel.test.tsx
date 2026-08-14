/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import type { ConversationItem } from "../conversation/projector.js";
import { ChatPanel } from "./ChatPanel.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderPanel(items: readonly ConversationItem[] = [], onDock = vi.fn()) {
	const registry = createCommandRegistry({
		commands: [{ id: "conversation.send", title: "Send message", description: "Sends the drafted message.", execute: vi.fn() }],
		bindings: [],
	});
	return render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<ChatPanel conversationItems={items} conversationLoading={false} conversationError={undefined} draft="" onDraftChange={vi.fn()} onComposerFocus={vi.fn()} onDock={onDock} />
		</CommandProvider>,
	);
}

const MESSAGES: ConversationItem[] = [
	{ kind: "message", role: "user", text: "First message", timestamp: 1 },
	{ kind: "message", role: "assistant", text: "Most recent reply", timestamp: 2 },
];

describe("ChatPanel", () => {
	it("is always mounted, interactive, and not gated by any hidden/inert state -- it's a permanent part of the shell, not a pop-up", () => {
		renderPanel();
		const panel = screen.getByRole("complementary", { name: "Chat" });
		expect(panel).not.toHaveAttribute("inert");
		expect(panel).not.toHaveAttribute("aria-hidden");
		expect(screen.getByLabelText("Message Pi")).toBeInTheDocument();
	});

	it("starts collapsed (peek): shows only the composer and the most recent reply, not the full transcript", () => {
		renderPanel(MESSAGES);
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
		expect(screen.queryByText("First message")).not.toBeInTheDocument();
	});

	it("peek shows a placeholder when there are no messages yet", () => {
		renderPanel([]);
		expect(screen.getByText("No messages yet.")).toBeInTheDocument();
	});

	it("peek shows a placeholder for a still-streaming reply (an empty-text message), not a blank, zero-height row", () => {
		renderPanel([...MESSAGES, { kind: "message", role: "assistant", text: "", timestamp: 3 }]);
		const peek = screen.getByRole("button", { name: "Expand chat to the full conversation" });
		expect(peek.textContent).not.toBe("");
	});

	it("clicking the peek row expands to the full transcript, revealing earlier messages", () => {
		renderPanel(MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));

		expect(screen.getByText("First message")).toBeInTheDocument();
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
		expect(screen.getByRole("log", { name: "AI conversation" })).toBeInTheDocument();
	});

	it("the collapse control returns from expanded back to peek", () => {
		renderPanel(MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));
		fireEvent.click(screen.getByRole("button", { name: "Collapse to the last reply" }));

		expect(screen.queryByText("First message")).not.toBeInTheDocument();
		expect(screen.getByText("Most recent reply")).toBeInTheDocument();
	});

	it("the collapsed peek has no panel chrome around the composer -- the same bare shape as the empty-landing state", () => {
		renderPanel(MESSAGES);
		const panel = screen.getByRole("complementary", { name: "Chat" });
		expect(panel.querySelector(".shadow-lg")).toBeNull();
		expect(panel.querySelector(".backdrop-blur")).toBeNull();
		expect(screen.getByLabelText("Message Pi").closest("div[class*='border-gray-300']")).not.toBeNull();
	});

	it("expanded keeps real panel chrome (background, border) -- a scrollable transcript genuinely needs it, unlike the minimal peek", () => {
		renderPanel(MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));
		const panel = screen.getByRole("complementary", { name: "Chat" });
		expect(panel.querySelector(".shadow-lg")).not.toBeNull();
	});

	it("is a plain full-width block, not absolutely positioned or draggable -- a real layout sibling, never a floating overlay", () => {
		renderPanel();
		const panel = screen.getByRole("complementary", { name: "Chat" });
		expect(panel.className).not.toContain("absolute");
		expect(panel.className).not.toContain("fixed");
		expect(panel.style.transform).toBe("");
	});

	it("the Dock button docks Chat, both collapsed and expanded", () => {
		const onDock = vi.fn();
		renderPanel(MESSAGES, onDock);
		fireEvent.click(screen.getByRole("button", { name: "Dock Chat into the active Window" }));
		expect(onDock).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));
		fireEvent.click(screen.getByRole("button", { name: "Dock Chat into the active Window" }));
		expect(onDock).toHaveBeenCalledTimes(2);
	});
});
