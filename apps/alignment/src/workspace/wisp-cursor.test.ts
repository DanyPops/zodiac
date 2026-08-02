import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../conversation/projector.js";
import { addWindow, createWorkspace, dockSurface, type Workspace } from "./model.js";
import { computeWispCursorStyle, latestToolCallName, resolveWispWindowIndex } from "./wisp-cursor.js";

const ANCHOR = { x: 100, y: 200 };

function fixtureWorkspace(): Workspace {
	return createWorkspace({ id: "fixture", title: "Fixture" });
}

function toolCall(toolName: string): ConversationItem {
	return { kind: "tool-call", toolCallId: "1", toolName, request: undefined, response: undefined, timestamp: 0 };
}

function message(): ConversationItem {
	return { kind: "message", role: "user", text: "hi", timestamp: 0 };
}

describe("computeWispCursorStyle", () => {
	it("is fully transparent when not visible, regardless of target", () => {
		expect(computeWispCursorStyle({ visible: false }, ANCHOR).opacity).toBe(0);
		expect(computeWispCursorStyle({ visible: false, target: { x: 1, y: 2 } }, ANCHOR).opacity).toBe(0);
	});

	it("is fully opaque and idle at the anchor when visible with no target", () => {
		const style = computeWispCursorStyle({ visible: true }, ANCHOR);
		expect(style.opacity).toBe(1);
		expect(style.idle).toBe(true);
		expect(style.transform).toBe("translate(100px, 200px)");
	});

	it("drifts to the target and stops idling once one is set", () => {
		const style = computeWispCursorStyle({ visible: true, target: { x: 42, y: 7 } }, ANCHOR);
		expect(style.opacity).toBe(1);
		expect(style.idle).toBe(false);
		expect(style.transform).toBe("translate(42px, 7px)");
	});

	it("reflects a different anchor when idle, not a hardcoded origin", () => {
		const style = computeWispCursorStyle({ visible: true }, { x: -10, y: 5 });
		expect(style.transform).toBe("translate(-10px, 5px)");
	});
});

describe("latestToolCallName", () => {
	it("is undefined for an empty or tool-call-free item list", () => {
		expect(latestToolCallName([])).toBeUndefined();
		expect(latestToolCallName([message()])).toBeUndefined();
	});

	it("returns the most recent tool call's name, not the first", () => {
		expect(latestToolCallName([toolCall("read"), message(), toolCall("bash")])).toBe("bash");
	});
});

describe("resolveWispWindowIndex", () => {
	it("is undefined with no tool call yet", () => {
		expect(resolveWispWindowIndex(fixtureWorkspace(), undefined)).toBeUndefined();
	});

	it("is undefined when the tool call matches no docked Surface's binding", () => {
		expect(resolveWispWindowIndex(fixtureWorkspace(), "edit")).toBeUndefined();
	});

	it("resolves to the index of the Window holding the matching bound Surface, even if it isn't the active Window", () => {
		let workspace = fixtureWorkspace();
		const { workspace: withFs } = dockSurface(workspace, "filesystem", "Filesystem", { kind: "filesystem", root: "/repo" });
		workspace = addWindow(withFs); // window 1, active; the bound Surface lives in window 0

		expect(resolveWispWindowIndex(workspace, "edit")).toBe(0);
	});
});
