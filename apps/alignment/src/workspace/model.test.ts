import { describe, expect, it } from "vitest";
import { activateSurface, createFirstSliceWorkspace, createWorkspace, visibleSurfaceId, withConversation } from "./model.js";

describe("Workspace surface containment", () => {
	it("builds one root Chat surface with parent-attached Conversation and Activity tabs", () => {
		const workspace = createFirstSliceWorkspace("fixture");

		expect(workspace.conversationId).toBe("fixture");
		expect(workspace.rootSurfaceIds).toEqual(["chat"]);
		const chat = workspace.surfaces.chat;
		const conversation = workspace.surfaces.conversation;
		const activity = workspace.surfaces.activity;
		expect(chat).toBeDefined();
		expect(conversation).toBeDefined();
		expect(activity).toBeDefined();
		expect(chat).toMatchObject({ kind: "chat", layout: "tabs" });
		expect(chat?.parentId).toBeUndefined();
		expect(conversation?.parentId).toBe("chat");
		expect(activity?.parentId).toBe("chat");
		expect(chat?.childIds).toEqual(["conversation", "activity"]);
	});

	it("rejects a containment cycle", () => {
		expect(() =>
			createWorkspace({
				id: "workspace",
				title: "Alignment",
				conversationId: "fixture",
				surfaces: [
					{ id: "one", kind: "chat", title: "One", layout: "tabs", parentId: "two" },
					{ id: "two", kind: "activity", title: "Two", layout: "tabs", parentId: "one" },
				],
			}),
		).toThrow(/cycle/i);
	});

	it("visibleSurfaceId defaults to the first child of a tabbed parent until one is explicitly activated", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		expect(visibleSurfaceId(workspace, "chat")).toBe("conversation");

		const afterActivate = activateSurface(workspace, "activity");
		expect(visibleSurfaceId(afterActivate, "chat")).toBe("activity");
		// activateSurface returns a new Workspace rather than mutating the original.
		expect(visibleSurfaceId(workspace, "chat")).toBe("conversation");
	});

	it("visibleSurfaceId is undefined for a leaf surface, which has no children to show", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		expect(visibleSurfaceId(workspace, "conversation")).toBeUndefined();
	});

	it("activateSurface rejects an unknown surface id", () => {
		const workspace = createFirstSliceWorkspace("fixture");
		expect(() => activateSurface(workspace, "does-not-exist")).toThrow(/unknown surface/i);
	});

	it("withConversation rebinds the conversation without disturbing surface visibility", () => {
		const workspace = activateSurface(createFirstSliceWorkspace("fixture"), "activity");
		const rebound = withConversation(workspace, "other-conversation");

		expect(rebound.conversationId).toBe("other-conversation");
		expect(visibleSurfaceId(rebound, "chat")).toBe("activity");
	});

	it("rejects duplicate ids and missing parents", () => {
		expect(() =>
			createWorkspace({
				id: "workspace",
				title: "Alignment",
				conversationId: "fixture",
				surfaces: [
					{ id: "chat", kind: "chat", title: "Chat", layout: "tabs" },
					{ id: "chat", kind: "conversation", title: "Conversation", layout: "leaf", parentId: "chat" },
				],
			}),
		).toThrow(/duplicate/i);

		expect(() =>
			createWorkspace({
				id: "workspace",
				title: "Alignment",
				conversationId: "fixture",
				surfaces: [
					{ id: "conversation", kind: "conversation", title: "Conversation", layout: "leaf", parentId: "missing" },
				],
			}),
		).toThrow(/missing parent/i);
	});
});
