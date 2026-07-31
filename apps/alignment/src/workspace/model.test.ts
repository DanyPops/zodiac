import { describe, expect, it } from "vitest";
import { activeWindow, addWindow, createFirstSliceWorkspace, createWorkspace, dockSurface, hideChat, nextWindow, previousWindow, selectWindow, showChat, toggleChat, undockSurface, withConversation } from "./model.js";

describe("Workspace window and Surface docking", () => {
	it("creates one empty Window, active by index 0, Chat hidden by default", () => {
		const workspace = createFirstSliceWorkspace("fixture");

		expect(workspace.conversationId).toBe("fixture");
		expect(workspace.windows).toHaveLength(1);
		expect(workspace.activeWindowIndex).toBe(0);
		expect(workspace.chatVisible).toBe(false);
		expect(activeWindow(workspace).dockedSurfaces).toEqual([]);
	});

	it("activeWindow throws for an out-of-bounds index rather than returning undefined silently", () => {
		const workspace = { ...createFirstSliceWorkspace("fixture"), activeWindowIndex: 5 };
		expect(() => activeWindow(workspace)).toThrow(/out-of-bounds/i);
	});

	describe("nextWindow / previousWindow wrap-around", () => {
		it("wraps past the last Window back to the first", () => {
			let workspace = createFirstSliceWorkspace("fixture");
			workspace = addWindow(workspace); // index 1
			workspace = addWindow(workspace); // index 2, active
			expect(workspace.activeWindowIndex).toBe(2);

			workspace = nextWindow(workspace);
			expect(workspace.activeWindowIndex).toBe(0);
		});

		it("wraps before the first Window back to the last", () => {
			let workspace = createFirstSliceWorkspace("fixture");
			workspace = addWindow(workspace); // index 1
			workspace = previousWindow(workspace); // back to index 0
			expect(workspace.activeWindowIndex).toBe(0);

			workspace = previousWindow(workspace); // wraps past the first to the last (index 1)
			expect(workspace.activeWindowIndex).toBe(1);
		});

		it("a single-Window Workspace wraps to itself", () => {
			const workspace = createFirstSliceWorkspace("fixture");
			expect(nextWindow(workspace).activeWindowIndex).toBe(0);
			expect(previousWindow(workspace).activeWindowIndex).toBe(0);
		});
	});

	describe("selectWindow", () => {
		it("jumps directly to a Window by index", () => {
			let workspace = createFirstSliceWorkspace("fixture");
			workspace = addWindow(addWindow(workspace)); // 3 windows, active index 2

			workspace = selectWindow(workspace, 0);
			expect(workspace.activeWindowIndex).toBe(0);
		});

		it("throws for an out-of-bounds index", () => {
			const workspace = createFirstSliceWorkspace("fixture");
			expect(() => selectWindow(workspace, 1)).toThrow(/no Window at index/i);
			expect(() => selectWindow(workspace, -1)).toThrow(/no Window at index/i);
		});
	});

	it("addWindow appends at the end and switches to it", () => {
		let workspace = createFirstSliceWorkspace("fixture");
		workspace = addWindow(workspace);

		expect(workspace.windows).toHaveLength(2);
		expect(workspace.activeWindowIndex).toBe(1);
	});

	it("dockSurface adds an instance to the active Window only, and undockSurface removes it from wherever it is", () => {
		let workspace = createFirstSliceWorkspace("fixture");
		workspace = addWindow(workspace); // now on window 1

		const docked = dockSurface(workspace, "activity", "Activity");
		workspace = docked.workspace;

		expect(workspace.windows[0]?.dockedSurfaces).toEqual([]);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([docked.instance]);

		workspace = undockSurface(workspace, docked.instance.id);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([]);
	});

	it("undockSurface is a no-op for an id that isn't docked anywhere", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		expect(undockSurface(workspace, "does-not-exist")).toEqual(workspace);
	});

	it("dockSurface issues a distinct id per instance, even for the same template", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		const first = dockSurface(workspace, "activity", "Activity");
		const second = dockSurface(first.workspace, "activity", "Activity");
		expect(second.instance.id).not.toBe(first.instance.id);
		expect(activeWindow(second.workspace).dockedSurfaces.map((surface) => surface.id)).toEqual([first.instance.id, second.instance.id]);
	});

	describe("Chat Surface visibility", () => {
		it("showChat/hideChat/toggleChat are pure and idempotent at their own boundary", () => {
			const hidden = createFirstSliceWorkspace("fixture");
			const shown = showChat(hidden);
			expect(shown.chatVisible).toBe(true);
			expect(hidden.chatVisible).toBe(false); // original untouched
			expect(showChat(shown)).toBe(shown); // already shown: same reference back
			expect(hideChat(shown).chatVisible).toBe(false);
			expect(hideChat(hidden)).toBe(hidden); // already hidden: same reference back

			expect(toggleChat(hidden).chatVisible).toBe(true);
			expect(toggleChat(shown).chatVisible).toBe(false);
		});
	});

	it("withConversation rebinds the conversation without disturbing Windows or Chat visibility", () => {
		const workspace = showChat(dockSurface(createFirstSliceWorkspace("fixture"), "activity", "Activity").workspace);
		const rebound = withConversation(workspace, "other-conversation");

		expect(rebound.conversationId).toBe("other-conversation");
		expect(rebound.chatVisible).toBe(true);
		expect(activeWindow(rebound).dockedSurfaces).toHaveLength(1);
	});

	it("withConversation is a no-op (same reference) when the conversation id is unchanged", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		expect(withConversation(workspace, "fixture")).toBe(workspace);
	});

	it("createWorkspace builds the requested id/title with one empty Window", () => {
		const workspace = createWorkspace({ id: "custom", title: "Custom", conversationId: "fixture" });
		expect(workspace.id).toBe("custom");
		expect(workspace.title).toBe("Custom");
		expect(workspace.windows).toHaveLength(1);
	});
});
