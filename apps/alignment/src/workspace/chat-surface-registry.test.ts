import { describe, expect, it } from "vitest";
import { createFirstSliceWorkspace } from "./model.js";
import { CHAT_SURFACE_REGISTRY, defaultChatSurfaceId } from "./chat-surface-registry.js";

describe("chat surface registry", () => {
	it("declares at least one surface with unique ids and command ids", () => {
		expect(CHAT_SURFACE_REGISTRY.length).toBeGreaterThan(0);
		const ids = CHAT_SURFACE_REGISTRY.map((surface) => surface.id);
		const commandIds = CHAT_SURFACE_REGISTRY.map((surface) => surface.showCommandId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(commandIds).size).toBe(commandIds.length);
	});

	it("defaults to the first registered surface", () => {
		expect(defaultChatSurfaceId()).toBe(CHAT_SURFACE_REGISTRY[0]?.id);
	});

	// The registry (UI representation binding) and the Workspace domain model
	// (containment) each list the Chat surface's children independently --
	// this pins them together so one drifting out of sync with the other
	// fails loudly here instead of silently in the rendered app.
	it("matches the Workspace model's Chat containment order exactly", () => {
		const chat = createFirstSliceWorkspace("fixture").surfaces.chat;
		expect(CHAT_SURFACE_REGISTRY.map((surface) => surface.id)).toEqual(chat?.childIds);
	});

	it("renders every surface's content from the registry, not a caller-owned switch", () => {
		for (const surface of CHAT_SURFACE_REGISTRY) {
			const node = surface.render({
				conversationItems: [],
				conversationLoading: false,
				conversationError: undefined,
				draft: "",
				onDraftChange: () => {},
				onComposerFocus: () => {},
			});
			expect(node).toBeTruthy();
		}
	});
});
