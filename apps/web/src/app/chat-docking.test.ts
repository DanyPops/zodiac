import { describe, expect, it } from "vitest";
import { CHAT_TEMPLATE_ID } from "../workspace/model.js";
import { chatDockedSurfaceFor } from "./chat-docking.js";

describe("chatDockedSurfaceFor", () => {
	it("synthesizes a Chat entry for a window that hasn't closed it", () => {
		const entry = chatDockedSurfaceFor("window-1", new Set());
		expect(entry).toEqual({ id: "chat-window-1", templateId: CHAT_TEMPLATE_ID, title: "Chat" });
	});

	it("returns undefined once that window's own Chat was explicitly closed", () => {
		expect(chatDockedSurfaceFor("window-1", new Set(["window-1"]))).toBeUndefined();
	});

	it("a closed window id never affects a different window", () => {
		const entry = chatDockedSurfaceFor("window-2", new Set(["window-1"]));
		expect(entry?.id).toBe("chat-window-2");
	});

	it("returns undefined with no windowId yet (pre-confirmation)", () => {
		expect(chatDockedSurfaceFor(undefined, new Set())).toBeUndefined();
	});
});
