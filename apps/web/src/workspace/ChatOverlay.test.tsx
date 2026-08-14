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

function renderOverlay(visible: boolean, items: readonly ConversationItem[] = [], overrides: Partial<{ position: { x: number; y: number }; dragging: boolean; onDragHandlePointerDown: (event: { clientX: number; clientY: number }) => void }> = {}) {
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
				position={overrides.position ?? { x: 0, y: 0 }}
				dragging={overrides.dragging ?? false}
				onDragHandlePointerDown={overrides.onDragHandlePointerDown ?? vi.fn()}
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
		expect(screen.getByLabelText("Message Pi")).toBeInTheDocument();
	});

	it("peek shows a placeholder when there are no messages yet", () => {
		renderOverlay(true, []);
		expect(screen.getByText("No messages yet.")).toBeInTheDocument();
	});

	it("peek shows a placeholder for a still-streaming reply (an empty-text message), not a blank, zero-height row", () => {
		renderOverlay(true, [...MESSAGES, { kind: "message", role: "assistant", text: "", timestamp: 3 }]);
		const peek = screen.getByRole("button", { name: "Expand chat to the full conversation" });
		expect(peek.textContent).not.toBe("");
	});

	it("clicking the peek row expands to the full transcript, revealing earlier messages", () => {
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

	it("the collapsed peek has no panel chrome around the composer -- the same bare shape as the empty-landing state", () => {
		renderOverlay(true, MESSAGES);
		const dialog = screen.getByRole("dialog");
		expect(dialog.querySelector(".shadow-2xl")).toBeNull();
		expect(dialog.querySelector("h2")).toBeNull();
		// Composer's own non-bare footer wrapper (border-t/bg-white/95/backdrop-blur) must be absent -- bare must actually be passed, not just visually similar.
		expect(dialog.querySelector(".backdrop-blur")).toBeNull();
		expect(screen.getByLabelText("Message Pi").closest("div[class*='border-gray-300']")).not.toBeNull();
	});

	it("expanded keeps real panel chrome (background, border) -- a scrollable transcript genuinely needs it, unlike the minimal peek", () => {
		renderOverlay(true, MESSAGES);
		fireEvent.click(screen.getByRole("button", { name: "Expand chat to the full conversation" }));
		const dialog = screen.getByRole("dialog");
		expect(dialog.querySelector("[class*='rounded-']")).not.toBeNull();
	});

	it("is 3/4 width, centered in its column -- not full width matching the Carousel", () => {
		renderOverlay(true);
		const dialog = screen.getByRole("dialog");
		expect(dialog.className).toContain("w-3/4");
		expect(dialog.className).toContain("left-1/2");
		expect(dialog.style.transform).toContain("translateX(calc(-50% + 0px))");
		expect(dialog.className).not.toContain("w-full");
		expect(dialog.className).not.toContain("inset-x-0");
	});

	describe("dragging", () => {
		it("applies the given position as a pixel offset alongside centering and show/hide", () => {
			renderOverlay(true, [], { position: { x: 42, y: -8 } });
			const dialog = screen.getByRole("dialog");
			expect(dialog.style.transform).toContain("translateX(calc(-50% + 42px))");
			expect(dialog.style.transform).toContain("translateY(-8px)");
		});

		it("pointer-down on the drag handle reports the pointer's client coordinates", () => {
			const onDragHandlePointerDown = vi.fn();
			renderOverlay(true, [], { onDragHandlePointerDown });
			fireEvent.pointerDown(screen.getByRole("button", { name: "Drag to move Chat" }), { clientX: 100, clientY: 200 });
			expect(onDragHandlePointerDown).toHaveBeenCalledWith(expect.objectContaining({ clientX: 100, clientY: 200 }));
		});

		it("clicking the Dock button never starts a drag", () => {
			const onDragHandlePointerDown = vi.fn();
			renderOverlay(true, [], { onDragHandlePointerDown });
			fireEvent.pointerDown(screen.getByRole("button", { name: "Dock Chat into the active Window" }));
			expect(onDragHandlePointerDown).not.toHaveBeenCalled();
		});

		it("suppresses the show/hide transition while actively dragging", () => {
			renderOverlay(true, [], { dragging: true });
			expect(screen.getByRole("dialog").className).not.toContain("transition-transform");
		});
	});
});
