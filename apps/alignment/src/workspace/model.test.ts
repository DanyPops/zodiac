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
	hideChat,
	isChatDocked,
	nextWindow,
	pinChat,
	previousWindow,
	renameWindow,
	scrollWindow,
	selectWindow,
	showChat,
	surfaceBindingKindForToolName,
	toggleChat,
	unpinChat,
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

	it("gives every Window a plain default title -- 'Window 1', 'Window 2', ...", () => {
		let workspace = fixtureWorkspace();
		expect(activeWindow(workspace).title).toBe("Window 1");

		workspace = addWindow(workspace);
		expect(activeWindow(workspace).title).toBe("Window 2");
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
			expect(scrolled.windows[2]).toMatchObject({ title: "Window 3", ephemeral: true, dockedSurfaces: [] });
		});

		it("scrolling backward past the first Window creates one new ephemeral Window at the start and switches to it, instead of wrapping", () => {
			let workspace = fixtureWorkspace();
			workspace = addWindow(workspace);
			workspace = selectWindow(workspace, 0);

			const scrolled = scrollWindow(workspace, -1);
			expect(scrolled.windows).toHaveLength(3);
			expect(scrolled.activeWindowIndex).toBe(0);
			expect(scrolled.windows[0]).toMatchObject({ ephemeral: true, dockedSurfaces: [] });
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

		it("dockChat always starts unpinned, even if a stale pinned flag was somehow set", () => {
			const workspace = pinChat({ ...fixtureWorkspace(), chatPinned: false });
			expect(dockChat(workspace, "Chat").workspace.chatPinned).toBe(false);
		});

		it("undockChatToFloating resets pin state", () => {
			const pinned = pinChat(dockChat(fixtureWorkspace(), "Chat").workspace);
			expect(undockChatToFloating(pinned).chatPinned).toBe(false);
		});

		describe("pinChat / unpinChat", () => {
			it("pinChat/unpinChat toggle chatPinned, idempotently returning the same reference when already in that state", () => {
				const unpinned = fixtureWorkspace();
				const pinned = pinChat(unpinned);
				expect(pinned.chatPinned).toBe(true);
				expect(pinChat(pinned)).toBe(pinned);

				const backToUnpinned = unpinChat(pinned);
				expect(backToUnpinned.chatPinned).toBe(false);
				expect(unpinChat(backToUnpinned)).toBe(backToUnpinned);
			});
		});

		describe("Chat follows the active Window while unpinned", () => {
			it("nextWindow relocates docked, unpinned Chat into the newly active Window", () => {
				let workspace = dockChat(fixtureWorkspace(), "Chat").workspace; // Chat in window 0
				workspace = addWindow(workspace); // window 1, active, empty
				workspace = selectWindow(workspace, 0); // back to window 0 where Chat lives

				workspace = nextWindow(workspace); // -> window 1
				expect(workspace.windows[0]?.dockedSurfaces).toEqual([]);
				expect(activeWindow(workspace).dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
			});

			it("previousWindow, selectWindow, and scrollWindow all relocate Chat the same way", () => {
				let base = dockChat(fixtureWorkspace(), "Chat").workspace;
				base = addWindow(base); // window 1, active, empty; Chat still in window 0

				for (const move of [(w: Workspace) => previousWindow(w), (w: Workspace) => selectWindow(w, 0), (w: Workspace) => scrollWindow(w, -1)]) {
					const moved = move(base);
					expect(activeWindow(moved).dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
				}
			});

			it("scrolling past the end into a fresh ephemeral Window relocates Chat there too", () => {
				const workspace = dockChat(fixtureWorkspace(), "Chat").workspace; // single Window, Chat docked
				const scrolled = scrollWindow(workspace, 1); // creates + activates a new ephemeral Window
				expect(scrolled.windows).toHaveLength(2);
				expect(activeWindow(scrolled).dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
				expect(scrolled.windows[0]?.dockedSurfaces).toEqual([]);
			});

			it("pinned Chat stays in its Window instead of following", () => {
				let workspace = pinChat(dockChat(fixtureWorkspace(), "Chat").workspace); // Chat pinned in window 0
				workspace = addWindow(workspace); // window 1, active
				workspace = selectWindow(workspace, 0);

				workspace = nextWindow(workspace); // -> window 1, but Chat is pinned
				expect(activeWindow(workspace).dockedSurfaces).toEqual([]);
				expect(workspace.windows[0]?.dockedSurfaces.some((s) => s.templateId === CHAT_TEMPLATE_ID)).toBe(true);
			});

			it("does nothing when Chat isn't docked at all", () => {
				let workspace = addWindow(fixtureWorkspace());
				workspace = selectWindow(workspace, 0);
				expect(() => nextWindow(workspace)).not.toThrow();
				expect(isChatDocked(nextWindow(workspace))).toBe(false);
			});

			it("does nothing when the active Window index doesn't actually change (e.g. a single-Window wrap-to-self)", () => {
				const workspace = dockChat(fixtureWorkspace(), "Chat").workspace;
				expect(nextWindow(workspace)).toEqual(workspace);
			});
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
