/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspace } from "./useWorkspace.js";

describe("useWorkspace", () => {
	it("creates the first-slice Workspace bound to the given conversation", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		expect(result.current.workspace.conversationId).toBe("fixture");
		expect(result.current.visibleSurfaceId("chat")).toBe("conversation");
	});

	it("activateSurface changes which child is visible", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		act(() => result.current.activateSurface("activity"));
		expect(result.current.visibleSurfaceId("chat")).toBe("activity");
	});

	it("rebinds to a new conversation without resetting which surface is visible", () => {
		const { result, rerender } = renderHook(({ conversationId }) => useWorkspace(conversationId), {
			initialProps: { conversationId: "fixture" },
		});
		act(() => result.current.activateSurface("activity"));

		rerender({ conversationId: "other-conversation" });

		expect(result.current.workspace.conversationId).toBe("other-conversation");
		expect(result.current.visibleSurfaceId("chat")).toBe("activity");
	});
});
