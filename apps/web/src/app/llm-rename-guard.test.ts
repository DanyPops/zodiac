import { describe, expect, it } from "vitest";
import { shouldApplyLlmRename } from "./llm-rename-guard.js";

describe("shouldApplyLlmRename", () => {
	it("allows the rename when the Workspace is still in the catalog (pending or confirmed)", () => {
		expect(shouldApplyLlmRename([{ id: "w1" }, { id: "w2" }], "w1")).toBe(true);
	});

	it("blocks the rename once the Workspace is no longer tracked -- the exact task 8facba42 scenario", () => {
		expect(shouldApplyLlmRename([{ id: "w2" }], "w1")).toBe(false);
	});

	it("blocks the rename against an empty catalog", () => {
		expect(shouldApplyLlmRename([], "w1")).toBe(false);
	});
});
