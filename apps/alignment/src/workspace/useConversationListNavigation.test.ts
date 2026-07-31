/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { useConversationListNavigation } from "./useConversationListNavigation.js";

function renderButtons(ids: readonly string[]): HTMLElement {
	const container = document.createElement("nav");
	for (const id of ids) {
		const button = document.createElement("button");
		button.dataset.conversationId = id;
		container.appendChild(button);
	}
	document.body.appendChild(container);
	return container;
}

describe("useConversationListNavigation", () => {
	it("moves focus forward and backward through the rendered conversation buttons", () => {
		const container = renderButtons(["a", "b", "c"]);
		const ref = createRef<HTMLElement>();
		Object.assign(ref, { current: container });
		const { result } = renderHook(() => useConversationListNavigation(ref));

		container.querySelector<HTMLButtonElement>('[data-conversation-id="a"]')?.focus();
		result.current.focusNext();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "b");

		result.current.focusNext();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "c");

		result.current.focusNext();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "c");

		result.current.focusPrevious();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "b");
	});

	it("first/last jump to the ends regardless of current focus", () => {
		const container = renderButtons(["a", "b", "c"]);
		const ref = createRef<HTMLElement>();
		Object.assign(ref, { current: container });
		const { result } = renderHook(() => useConversationListNavigation(ref));

		container.querySelector<HTMLButtonElement>('[data-conversation-id="b"]')?.focus();
		result.current.focusLast();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "c");

		result.current.focusFirst();
		expect(document.activeElement).toHaveAttribute("data-conversation-id", "a");
	});

	it("does nothing when no conversation buttons are rendered", () => {
		const ref = createRef<HTMLElement>();
		Object.assign(ref, { current: document.createElement("nav") });
		const { result } = renderHook(() => useConversationListNavigation(ref));
		expect(() => result.current.focusNext()).not.toThrow();
	});
});
