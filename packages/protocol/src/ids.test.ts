import { describe, expect, it } from "vitest";
import { WindowIdSchema, WorkspaceIdSchema, workspaceId, windowId } from "./ids.js";

describe("branded ids", () => {
	it("a smart constructor accepts a trimmed non-empty string", () => {
		expect(workspaceId("  bug-triage  ")).toBe("bug-triage");
	});

	it("a smart constructor throws on a blank literal -- a hardcoded bad id is a programmer error", () => {
		expect(() => workspaceId("   ")).toThrow(/non-empty/i);
	});

	it("two branded ids of different kinds are structurally identical strings but nominally distinct types", () => {
		// This is a compile-time property (a WorkspaceId cannot be passed where
		// a WindowId is expected); at runtime both are still just strings.
		const workspace = workspaceId("bug-triage");
		const window = windowId("bug-triage");
		expect(workspace).toBe(window);
	});

	it("schema.safeParse rejects a non-string and an empty string without throwing", () => {
		expect(WorkspaceIdSchema.safeParse(42).success).toBe(false);
		expect(WorkspaceIdSchema.safeParse("").success).toBe(false);
		expect(WindowIdSchema.safeParse(undefined).success).toBe(false);
	});

	it("schema.safeParse trims the same way the smart constructor does", () => {
		const result = WorkspaceIdSchema.safeParse("  w1  ");
		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe("w1");
	});
});
