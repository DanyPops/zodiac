/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { ChatOverlay } from "./ChatOverlay.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderOverlay(visible: boolean) {
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
				conversationItems={[]}
				conversationLoading={false}
				conversationError={undefined}
				draft=""
				onDraftChange={vi.fn()}
				onComposerFocus={vi.fn()}
			/>
		</CommandProvider>,
	);
}

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
});
