/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspace } from "./useWorkspace.js";

describe("useWorkspace", () => {
	it("creates the first-slice Workspace bound to the given conversation, one empty Window, Chat hidden", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		expect(result.current.workspace.conversationId).toBe("fixture");
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
		expect(result.current.workspace.chatVisible).toBe(false);
	});

	it("nextWindow/previousWindow/addWindow drive the active Window forward, backward, and to a fresh one", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));

		act(() => result.current.addWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(1);

		act(() => result.current.previousWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(0);

		act(() => result.current.previousWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(1); // wraps to the last

		act(() => result.current.nextWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(0); // wraps to the first
	});

	it("selectWindow jumps directly to an index", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		act(() => result.current.addWindow());
		act(() => result.current.addWindow());
		expect(result.current.workspace.activeWindowIndex).toBe(2);

		act(() => result.current.selectWindow(0));
		expect(result.current.workspace.activeWindowIndex).toBe(0);
	});

	it("dockSurface adds to the active Window and returns the created instance; undockSurface removes it", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockSurface("activity", "Activity").id;
		});
		expect(result.current.activeWindow.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockSurface(instanceId));
		expect(result.current.activeWindow.dockedSurfaces).toEqual([]);
	});

	it("showChat/hideChat/toggleChat drive Chat Surface visibility", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));

		act(() => result.current.showChat());
		expect(result.current.workspace.chatVisible).toBe(true);

		act(() => result.current.hideChat());
		expect(result.current.workspace.chatVisible).toBe(false);

		act(() => result.current.toggleChat());
		expect(result.current.workspace.chatVisible).toBe(true);
	});

	it("scrollWindow drives the Window Carousel's mouse-wheel policy (create-past-edge, prune-on-leave)", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		const firstWindowId = result.current.workspace.windows[0]?.id;

		act(() => result.current.scrollWindow(1));
		expect(result.current.workspace.windows).toHaveLength(1);
		expect(result.current.workspace.windows[0]?.id).not.toBe(firstWindowId);
	});

	it("dockChat/isChatDocked/undockChatToFloating drive Chat between floating and docked", () => {
		const { result } = renderHook(() => useWorkspace("fixture"));
		expect(result.current.isChatDocked).toBe(false);

		let instanceId = "";
		act(() => {
			instanceId = result.current.dockChat("Chat").id;
		});
		expect(result.current.isChatDocked).toBe(true);
		expect(result.current.workspace.chatVisible).toBe(false);
		expect(result.current.activeWindow.dockedSurfaces.map((surface) => surface.id)).toEqual([instanceId]);

		act(() => result.current.undockChatToFloating());
		expect(result.current.isChatDocked).toBe(false);
		expect(result.current.workspace.chatVisible).toBe(true);
	});

	it("rebinds to a new conversation without resetting Windows or Chat visibility", () => {
		const { result, rerender } = renderHook(({ conversationId }) => useWorkspace(conversationId), {
			initialProps: { conversationId: "fixture" },
		});
		act(() => result.current.showChat());
		act(() => {
			result.current.dockSurface("activity", "Activity");
		});

		rerender({ conversationId: "other-conversation" });

		expect(result.current.workspace.conversationId).toBe("other-conversation");
		expect(result.current.workspace.chatVisible).toBe(true);
		expect(result.current.activeWindow.dockedSurfaces).toHaveLength(1);
	});
});
