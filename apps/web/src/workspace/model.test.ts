import { describe, expect, it } from "vitest";
import {
	activeWindow,
	addWindow,
	CHAT_TEMPLATE_ID,
	createWorkspace,
	dockChat,
	dockSurface,
	findDockedSurfaceForToolName,
	findWorkspaceIdForToolName,
	isChatDocked,
	nextWindow,
	previousWindow,
	renameWindow,
	renameWorkspace,
	scrollWindow,
	selectWindow,
	surfaceBindingKindForToolName,
	undockSurface,
	type Workspace,
} from "./model.js";

/** A Workspace is its own independent thing -- never bound to a Conversation, which is a Surface that may or may not exist inside one. This fixture stands in for whichever catalog entry a test needs. */
function fixtureWorkspace(): Workspace {
	return createWorkspace({ id: "fixture", title: "Fixture" });
}

describe("Workspace window and Surface docking", () => {
	it("creates one Window, active by index 0, with Chat pre-docked and nothing else", () => {
		const workspace = fixtureWorkspace();

		expect(workspace.windows).toHaveLength(1);
		expect(workspace.activeWindowIndex).toBe(0);
		expect(activeWindow(workspace).dockedSurfaces.map((s) => s.templateId)).toEqual([CHAT_TEMPLATE_ID]);
	});

	it("gives every Window a plain default title matching its own 0-based index -- the same number the Carousel pill displays", () => {
		let workspace = fixtureWorkspace();
		expect(activeWindow(workspace).title).toBe("Window 0");

		workspace = addWindow(workspace);
		expect(activeWindow(workspace).title).toBe("Window 1");
	});

	it("never disagrees with the Carousel's own displayed index -- every Window's default title number equals its real array index", () => {
		let workspace = fixtureWorkspace();
		workspace = addWindow(workspace);
		workspace = addWindow(workspace);
		workspace.windows.forEach((window, index) => expect(window.title).toBe(`Window ${index}`));
	});

	describe("renameWindow", () => {
		it("renames a Window by id", () => {
			const workspace = fixtureWorkspace();
			const windowId = activeWindow(workspace).id;
			const renamed = renameWindow(workspace, windowId, "Debugging");
			expect(activeWindow(renamed).title).toBe("Debugging");
		});

		it("trims whitespace", () => {
			const workspace = fixtureWorkspace();
			const renamed = renameWindow(workspace, activeWindow(workspace).id, "  Debugging  ");
			expect(activeWindow(renamed).title).toBe("Debugging");
		});

		it("rejects a blank title, leaving the Window unchanged", () => {
			const workspace = fixtureWorkspace();
			expect(renameWindow(workspace, activeWindow(workspace).id, "   ")).toBe(workspace);
		});

		it("is a no-op for an unknown Window id", () => {
			const workspace = fixtureWorkspace();
			expect(renameWindow(workspace, "does-not-exist", "New title")).toEqual(workspace);
		});
	});

	describe("renameWorkspace", () => {
		it("renames the Workspace itself", () => {
			const workspace = fixtureWorkspace();
			expect(renameWorkspace(workspace, "Deploys").title).toBe("Deploys");
		});

		it("trims whitespace", () => {
			const workspace = fixtureWorkspace();
			expect(renameWorkspace(workspace, "  Deploys  ").title).toBe("Deploys");
		});

		it("rejects a blank title, leaving the Workspace unchanged", () => {
			const workspace = fixtureWorkspace();
			expect(renameWorkspace(workspace, "   ")).toBe(workspace);
		});
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

	describe("scrollWindow: the Window Carousel's own scroll policy (not the same ring as nextWindow/previousWindow)", () => {
		it("a mid-list scroll is a plain +/-1 step, same as nextWindow/previousWindow", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1
			workspace = addWindow(workspace); // window 2
			workspace = selectWindow(workspace, 1);

			expect(scrollWindow(workspace, 1).activeWindowIndex).toBe(2);
			expect(scrollWindow(workspace, -1).activeWindowIndex).toBe(0);
		});

		it("scrolling forward past the last Window creates one new ephemeral Window and switches to it, instead of wrapping", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace); // window 1, active

			const scrolled = scrollWindow(workspace, 1);
			expect(scrolled.windows).toHaveLength(3);
			expect(scrolled.activeWindowIndex).toBe(2);
			expect(scrolled.windows[2]).toMatchObject({ title: "Window 2", ephemeral: true });
			expect(scrolled.windows[2]?.dockedSurfaces.map((s) => s.templateId)).toEqual([CHAT_TEMPLATE_ID]);
		});

		it("scrolling backward past the first Window creates one new ephemeral Window at the start and switches to it, instead of wrapping", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace);
			workspace = selectWindow(workspace, 0);

			const scrolled = scrollWindow(workspace, -1);
			expect(scrolled.windows).toHaveLength(3);
			expect(scrolled.activeWindowIndex).toBe(0);
			expect(scrolled.windows[0]).toMatchObject({ ephemeral: true });
			expect(scrolled.windows[0]?.dockedSurfaces.map((s) => s.templateId)).toEqual([CHAT_TEMPLATE_ID]);
		});

		it("scrolling further past the end while already on an empty ephemeral Window is a no-op, not another new Window", () => {
			const workspace = scrollWindow(fixtureWorkspace(), 1); // creates one ephemeral Window, 2 total
			expect(scrollWindow(workspace, 1)).toEqual(workspace);
		});

		it("scrolling away from an empty ephemeral Window prunes it", () => {
			let workspace = scrollWindow(fixtureWorkspace(), 1); // window 0 (real), window 1 (ephemeral, active)
			expect(workspace.windows).toHaveLength(2);

			workspace = scrollWindow(workspace, -1); // back to the real Window -- the empty ephemeral one is pruned
			expect(workspace.windows).toHaveLength(1);
			expect(workspace.activeWindowIndex).toBe(0);
		});

		it("an ephemeral Window with a docked Surface survives -- dockSurface promotes it to permanent", () => {
			let workspace = scrollWindow(fixtureWorkspace(), 1); // window 1 is ephemeral, active
			workspace = dockSurface(workspace, "activity", "Activity").workspace;

			workspace = scrollWindow(workspace, -1); // leave it
			expect(workspace.windows).toHaveLength(2); // survives -- no longer eligible for pruning
			expect(workspace.windows[1]?.ephemeral).toBe(false);
		});
	});

	describe("Chat Surface docking", () => {
		it("every Window starts with Chat already docked -- always, not something to separately toggle on", () => {
			const workspace = fixtureWorkspace();
			expect(isChatDocked(workspace)).toBe(true);
			expect(activeWindow(workspace).dockedSurfaces).toHaveLength(1);
			expect(activeWindow(workspace).dockedSurfaces[0]?.templateId).toBe(CHAT_TEMPLATE_ID);
		});

		it("a freshly addWindow'd Window also starts with its own Chat, independent of any other Window's", () => {
			const workspace = addWindow(fixtureWorkspace());
			expect(activeWindow(workspace).dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
			// Two real, distinct instances, not the same one relocated.
			expect(activeWindow(workspace).dockedSurfaces[0]?.id).not.toBe(workspace.windows[0]?.dockedSurfaces[0]?.id);
		});

		it("dockChat is a no-op (same instance back) when the active Window's Chat is already docked", () => {
			const workspace = fixtureWorkspace();
			const existing = activeWindow(workspace).dockedSurfaces[0]!;
			const redocked = dockChat(workspace, "Chat");
			expect(redocked.workspace).toBe(workspace);
			expect(redocked.instance).toBe(existing);
		});

		it("dockChat re-docks Chat into the active Window if the user closed it", () => {
			const workspace = fixtureWorkspace();
			const closed = undockSurface(workspace, activeWindow(workspace).dockedSurfaces[0]!.id);
			expect(isChatDocked(closed)).toBe(false);

			const redocked = dockChat(closed, "Chat");
			expect(isChatDocked(redocked.workspace)).toBe(true);
			expect(redocked.instance.templateId).toBe(CHAT_TEMPLATE_ID);
		});

		it("closing Chat in one Window never affects another Window's own instance", () => {
			let workspace = addWindow(fixtureWorkspace()); // window 1, active, own Chat
			const window1ChatId = activeWindow(workspace).dockedSurfaces[0]!.id;
			workspace = undockSurface(workspace, window1ChatId);

			expect(isChatDocked({ ...workspace, windows: [workspace.windows[1]!] })).toBe(false);
			expect(workspace.windows[0]?.dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
		});

		it("switching the active Window never relocates or duplicates Chat -- each Window already carries its own", () => {
			let workspace = addWindow(fixtureWorkspace()); // window 1, active
			const window0ChatId = workspace.windows[0]?.dockedSurfaces[0]?.id;
			const window1ChatId = activeWindow(workspace).dockedSurfaces[0]?.id;

			workspace = selectWindow(workspace, 0);
			expect(activeWindow(workspace).dockedSurfaces[0]?.id).toBe(window0ChatId);
			workspace = nextWindow(workspace);
			expect(activeWindow(workspace).dockedSurfaces[0]?.id).toBe(window1ChatId);
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
		const window0Chat = workspace.windows[0]?.dockedSurfaces[0];
		const window1Chat = activeWindow(workspace).dockedSurfaces[0]!;

		const docked = dockSurface(workspace, "activity", "Activity");
		workspace = docked.workspace;

		expect(workspace.windows[0]?.dockedSurfaces).toEqual([window0Chat]);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([window1Chat, docked.instance]);

		workspace = undockSurface(workspace, docked.instance.id);
		expect(workspace.windows[1]?.dockedSurfaces).toEqual([window1Chat]);
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

		it("findWorkspaceIdForToolName finds which Workspace (by id) in a registry the tool call is about", () => {
			const withFs = dockSurface(createWorkspace({ id: "b", title: "B" }), "filesystem", "Filesystem", { kind: "filesystem", root: "/repo" }).workspace;
			const registry = { a: createWorkspace({ id: "a", title: "A" }), b: withFs };
			expect(findWorkspaceIdForToolName(registry, "edit")).toBe("b");
		});

		it("findWorkspaceIdForToolName returns undefined when no Workspace in the registry has a matching binding", () => {
			const registry = { a: createWorkspace({ id: "a", title: "A" }) };
			expect(findWorkspaceIdForToolName(registry, "edit")).toBeUndefined();
		});
	});

	it("dockSurface issues a distinct id per instance, even for the same template", () => {
		const workspace = fixtureWorkspace();
		const chatId = activeWindow(workspace).dockedSurfaces[0]!.id;
		const first = dockSurface(workspace, "activity", "Activity");
		const second = dockSurface(first.workspace, "activity", "Activity");
		expect(second.instance.id).not.toBe(first.instance.id);
		expect(activeWindow(second.workspace).dockedSurfaces.map((surface) => surface.id)).toEqual([chatId, first.instance.id, second.instance.id]);
	});

	it("createWorkspace builds the requested id/title with one empty Window, independent of any Conversation", () => {
		const workspace = createWorkspace({ id: "custom", title: "Custom" });
		expect(workspace.id).toBe("custom");
		expect(workspace.title).toBe("Custom");
		expect(workspace.windows).toHaveLength(1);
		expect(workspace).not.toHaveProperty("conversationId");
	});
});
