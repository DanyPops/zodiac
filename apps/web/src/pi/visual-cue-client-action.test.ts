import { registerCue } from "@zodiac/ui/cues";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualCueClientActionHandler } from "./visual-cue-client-action.js";

describe("createVisualCueClientActionHandler", () => {
	const unregisters: Array<() => void> = [];
	afterEach(() => {
		while (unregisters.length > 0) unregisters.pop()?.();
	});

	it("given a tool-call-start event for list_visual_cues, calls the real listCues() and posts the result back", async () => {
		unregisters.push(registerCue({ kind: "gallery-category", id: "lector" }, { cue: "highlight", description: "Try Lector" }));
		const postClientAction = vi.fn().mockResolvedValue(undefined);
		const handler = createVisualCueClientActionHandler(postClientAction);

		handler({ sessionId: "sess-1", toolCallId: "call-1", toolName: "list_visual_cues", input: {} });
		await Promise.resolve();
		await Promise.resolve();

		expect(postClientAction).toHaveBeenCalledWith("sess-1", "call-1", { cues: [expect.objectContaining({ id: "lector" })] });
	});

	it("given a tool-call-start event for any other tool, does nothing -- never posts for an unrelated tool call", async () => {
		const postClientAction = vi.fn().mockResolvedValue(undefined);
		const handler = createVisualCueClientActionHandler(postClientAction);

		handler({ sessionId: "sess-1", toolCallId: "call-2", toolName: "list_integrations", input: {} });
		await Promise.resolve();

		expect(postClientAction).not.toHaveBeenCalled();
	});

	it("a failed POST-back is caught, not thrown -- a real, already-handled outcome on the daemon side (eventual NoClientObservedError timeout), not a crash here", async () => {
		const postClientAction = vi.fn().mockRejectedValue(new Error("network down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = createVisualCueClientActionHandler(postClientAction);

		expect(() => handler({ sessionId: "sess-1", toolCallId: "call-3", toolName: "list_visual_cues", input: {} })).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();

		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
