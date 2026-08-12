/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationClient, ConversationSummary } from "./client.js";
import { useConversationWorkspace } from "./useConversationWorkspace.js";

function summary(id: string): ConversationSummary {
	return { id, latestSessionId: `${id}-session`, lastActiveAt: new Date().toISOString(), totalTurns: 0, totalErrors: 0 };
}

function fakeClient(conversations: ConversationSummary[]): ConversationClient {
	return {
		list: vi.fn(async () => conversations),
		loadEvents: vi.fn(async () => []),
	};
}

describe("useConversationWorkspace", () => {
	it("loads the conversation list and selects the first one by default", async () => {
		const client = fakeClient([summary("a"), summary("b")]);
		const { result } = renderHook(() => useConversationWorkspace(client));

		await waitFor(() => expect(result.current.conversationsLoading).toBe(false));

		expect(result.current.conversations.map((c) => c.id)).toEqual(["a", "b"]);
		expect(result.current.selectedConversationId).toBe("a");
	});

	it("surfaces a list load failure as a human-readable error", async () => {
		const client: ConversationClient = {
			list: vi.fn(async () => {
				throw new Error("boom");
			}),
			loadEvents: vi.fn(async () => []),
		};
		const { result } = renderHook(() => useConversationWorkspace(client));

		await waitFor(() => expect(result.current.conversationError).toMatch(/boom/));
	});

	it("openConversation resolves the last-focused conversation before falling back to selected or first", async () => {
		const client = fakeClient([summary("a"), summary("b"), summary("c")]);
		const { result } = renderHook(() => useConversationWorkspace(client));
		await waitFor(() => expect(result.current.conversationsLoading).toBe(false));

		act(() => result.current.notifyConversationFocused("c"));

		let resolved: string | undefined;
		act(() => {
			resolved = result.current.openConversation();
		});

		expect(resolved).toBe("c");
		expect(result.current.selectedConversationId).toBe("c");
	});

	it("openConversation prefers an explicit id over any fallback", async () => {
		const client = fakeClient([summary("a")]);
		const { result } = renderHook(() => useConversationWorkspace(client));
		await waitFor(() => expect(result.current.conversationsLoading).toBe(false));

		let resolved: string | undefined;
		act(() => {
			resolved = result.current.openConversation("explicit");
		});

		expect(resolved).toBe("explicit");
		expect(result.current.selectedConversationId).toBe("explicit");
	});

});
