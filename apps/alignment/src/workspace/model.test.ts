import { describe, expect, it } from "vitest";
import {
	activeWindow,
	addWindow,
	CHAT_TEMPLATE_ID,
	createWorkspace,
	dockChat,
	dockSurface,
	findDockedSurfaceForToolName,
	hideChat,
	isChatDocked,
	nextWindow,
	previousWindow,
	scrollWindow,
	selectWindow,
	showChat,
	surfaceBindingKindForToolName,
	toggleChat,
	undockChatToFloating,
	undockSurface,
	type Workspace,
} from "./model.js";

/** A Workspace is its own independent thing -- never bound to a Conversation, which is a Surface that may or may not exist inside one. This fixture stands in for whichever catalog entry a test needs. */
function fixtureWorkspace(): Workspace {
	return createWorkspace({ id: "fixture", title: "Fixture" });
}

describe("Workspace window and Surface docking", () => {
	it("creates one empty Window, active by index 0, Chat hidden by default", () => {
		const workspace = fixtureWorkspace();

		expect(workspace.windows).toHaveLength(1);
		expect(workspace.activeWindowIndex).toBe(0);
		expect(workspace.chatVisible).toBe(false);
		expect(activeWindow(workspace).dockedSurfaces).toEqual([]);
	});

	it("activeWindow throws for an out-of-bounds index rather than returning undefined silently", () => {
		const workspace = { ...fixtureWorkspace(), activeWindowIndex: 5 };
		expect(() => activeWindow(workspace)).toThrow(/out-of-bounds/i);
	});

	describe("nextWindow / previousWindow wrap-around", () => {
		it("wraps past the last Window back to the first", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // index 1
			workspace = addWindow(workspace); // index 2, active
			expect(workspace.activeWindowIndex).toBe(2);

			workspace = nextWindow(workspace);
			expect(workspace.activeWindowIndex).toBe(0);
		});

		it("wraps before the first Window back to the last", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // index 1
			workspace = previousWindow(workspace); // back to index 0
			expect(workspace.activeWindowIndex).toBe(0);

			workspace = previousWindow(workspace); // wraps past the first to the last (index 1)
			expect(workspace.activeWindowIndex).toBe(1);
		});

		it("a single-Window Workspace wraps to itself", () => {
			const workspace = fixtureWorkspace();
			expect(nextWindow(workspace).activeWindowIndex).toBe(0);
			expect(previousWindow(workspace).activeWindowIndex).toBe(0);
		});
	});

	describe("scrollWindow: the Window Carousel's mouse-wheel policy", () => {
		it("is the exact same wrap-around ring as nextWindow/previousWindow, not a separate policy", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1
			workspace = addWindow(workspace); // window 2
			workspace = selectWindow(workspace, 0);

			expect(scrollWindow(workspace, 1)).toEqual(nextWindow(workspace));
			expect(scrollWindow(workspace, -1)).toEqual(previousWindow(workspace));
		});

		it("wraps from the last Window back to the first when scrolling forward, without creating or pruning anything", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1
			workspace = addWindow(workspace); // window 2, active

			const scrolled = scrollWindow(workspace, 1);
			expect(scrolled.activeWindowIndex).toBe(0);
			expect(scrolled.windows).toHaveLength(3);
		});

		it("wraps from the first Window back to the last when scrolling backward, without creating or pruning anything", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1
			workspace = addWindow(workspace); // window 2
			workspace = selectWindow(workspace, 0);

			const scrolled = scrollWindow(workspace, -1);
			expect(scrolled.activeWindowIndex).toBe(2);
			expect(scrolled.windows).toHaveLength(3);
		});

		it("never creates or prunes a Window -- scrolling through several empty Windows leaves every one of them intact", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1
			workspace = addWindow(workspace); // window 2
			workspace = addWindow(workspace); // window 3
			workspace = selectWindow(workspace, 2);

			workspace = scrollWindow(workspace, 1); // to window 3
			expect(workspace.windows).toHaveLength(4); // every Window survives
			expect(workspace.activeWindowIndex).toBe(3);

			workspace = scrollWindow(workspace, 1); // wraps to window 0
			expect(workspace.windows).toHaveLength(4);
			expect(workspace.activeWindowIndex).toBe(0);
		});
	});

	describe("Chat Surface docking", () => {
		it("dockChat docks into the active Window as a singleton, hiding the floating overlay", () => {
			let workspace = showChat(fixtureWorkspace());
			const docked = dockChat(workspace, "Chat");
			workspace = docked.workspace;

			expect(workspace.chatVisible).toBe(false);
			expect(isChatDocked(workspace)).toBe(true);
			expect(activeWindow(workspace).dockedSurfaces).toEqual([docked.instance]);
			expect(docked.instance.templateId).toBe(CHAT_TEMPLATE_ID);
		});

		it("dockChat moves an already-docked Chat rather than creating a second instance", () => {
			let workspace = dockChat(fixtureWorkspace(), "Chat").workspace;
			workspace = addWindow(workspace); // window 1, active

			const redocked = dockChat(workspace, "Chat");
			expect(redocked.workspace.windows[0]?.dockedSurfaces).toEqual([]);
			expect(activeWindow(redocked.workspace).dockedSurfaces).toEqual([redocked.instance]);
		});

		it("undockChatToFloating removes it from wherever it's docked and shows the floating overlay", () => {
			const workspace = undockChatToFloating(dockChat(fixtureWorkspace(), "Chat").workspace);
			expect(isChatDocked(workspace)).toBe(false);
			expect(workspace.chatVisible).toBe(true);
		});

		it("undockChatToFloating is a safe no-op-shaped call when Chat isn't docked", () => {
			const workspace = fixtureWorkspace();
			expect(isChatDocked(undockChatToFloating(workspace))).toBe(false);
		});
	});

	describe("selectWindow", () => {
		it("jumps directly to a Window by index", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(addWindow(workspace)); // 3 windows, active index 2

			workspace = selectWindow(workspace, 0);
			expect(workspace.activeWindowIndex).toBe(0);
		});

		it("throws for an out-of-bounds index", () => {
			const workspace = fixtureWorkspace();
			expect(() => selectWindow(workspace, 1)).toThrow(/no Window at index/i);
			expect(() => selectWindow(workspace, -1)).toThrow(/no Window at index/i);
		});
	});

	it("addWindow appends at the end and switches to it", () => {
		let workspace = fixtureWorkspace();
		workspace = addWindow(workspace);

		expect(workspace.windows).toHaveLength(2);
		expect(workspace.activeWindowIndex).toBe(1);
	});

	it("dockSurface adds an instance to the active Window only, and undockSurface removes it from wherever it is", () => {
		let workspace = fixtureWorkspace();
		workspace = addWindow(workspace); // now on window 1

		const docked = dockSurface(workspace, "activity", "Activity");
		workspace = docked.workspace;

		expect(workspace.windows[0]?.dockedSurfaces).toEqual([]);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([docked.instance]);

		workspace = undockSurface(workspace, docked.instance.id);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([]);
	});

	it("undockSurface is a no-op for an id that isn't docked anywhere", () => {
		const workspace = fixtureWorkspace();
		expect(undockSurface(workspace, "does-not-exist")).toEqual(workspace);
	});

	describe("Surface bindings", () => {
		it("dockSurface leaves binding undefined when none is given", () => {
			const { instance } = dockSurface(fixtureWorkspace(), "activity", "Activity");
			expect(instance.binding).toBeUndefined();
		});

		it("dockSurface records a real binding when given one", () => {
			const { instance } = dockSurface(fixtureWorkspace(), "filesystem", "Filesystem", { kind: "filesystem", root: "/home/user/project" });
			expect(instance.binding).toEqual({ kind: "filesystem", root: "/home/user/project" });
		});

		it("surfaceBindingKindForToolName maps known Pi/Alef tool names to a binding kind", () => {
			expect(surfaceBindingKindForToolName("read")).toBe("filesystem");
			expect(surfaceBindingKindForToolName("edit")).toBe("filesystem");
			expect(surfaceBindingKindForToolName("bash")).toBe("terminal");
			expect(surfaceBindingKindForToolName("totally-unknown-tool")).toBeUndefined();
		});

		it("findDockedSurfaceForToolName finds a bound Surface anywhere in the Workspace, not just the active Window", () => {
			let workspace = fixtureWorkspace();
			const { workspace: withFs, instance } = dockSurface(workspace, "filesystem", "Filesystem", { kind: "filesystem", root: "/repo" });
			workspace = addWindow(withFs); // now on a different, empty Window

			const found = findDockedSurfaceForToolName(workspace, "edit");
			expect(found?.instance).toEqual(instance);
		});

		it("findDockedSurfaceForToolName returns undefined when no Surface matches the tool's kind", () => {
			const workspace = dockSurface(fixtureWorkspace(), "activity", "Activity").workspace;
			expect(findDockedSurfaceForToolName(workspace, "edit")).toBeUndefined();
		});

		it("findDockedSurfaceForToolName returns undefined for a tool name with no known binding kind", () => {
			const workspace = dockSurface(fixtureWorkspace(), "filesystem", "Filesystem", { kind: "filesystem", root: "/repo" }).workspace;
			expect(findDockedSurfaceForToolName(workspace, "totally-unknown-tool")).toBeUndefined();
		});
	});

	it("dockSurface issues a distinct id per instance, even for the same template", () => {
		const workspace = fixtureWorkspace();
		const first = dockSurface(workspace, "activity", "Activity");
		const second = dockSurface(first.workspace, "activity", "Activity");
		expect(second.instance.id).not.toBe(first.instance.id);
		expect(activeWindow(second.workspace).dockedSurfaces.map((surface) => surface.id)).toEqual([first.instance.id, second.instance.id]);
	});

	describe("Chat Surface visibility", () => {
		it("showChat/hideChat/toggleChat are pure and idempotent at their own boundary", () => {
			const hidden = fixtureWorkspace();
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

	it("createWorkspace builds the requested id/title with one empty Window, independent of any Conversation", () => {
		const workspace = createWorkspace({ id: "custom", title: "Custom" });
		expect(workspace.id).toBe("custom");
		expect(workspace.title).toBe("Custom");
		expect(workspace.windows).toHaveLength(1);
		expect(workspace).not.toHaveProperty("conversationId");
	});
});
