import { describe, expect, it } from "vitest";
import { commandId } from "@zodiac/protocol";
import { pruneAcknowledgedRename, type PendingRename } from "./pending-rename.js";

describe("pruneAcknowledgedRename", () => {
	it("drops the pending entry whose own commandId was just acknowledged", () => {
		const current: Readonly<Record<string, PendingRename>> = { "workspace-1": { title: "New Title", commandId: commandId("cmd-1") } };
		const next = pruneAcknowledgedRename(current, commandId("cmd-1"));
		expect(next).toEqual({});
	});

	it("leaves every other pending entry untouched", () => {
		const current: Readonly<Record<string, PendingRename>> = {
			"workspace-1": { title: "Title One", commandId: commandId("cmd-1") },
			"workspace-2": { title: "Title Two", commandId: commandId("cmd-2") },
		};
		const next = pruneAcknowledgedRename(current, commandId("cmd-1"));
		expect(next).toEqual({ "workspace-2": { title: "Title Two", commandId: commandId("cmd-2") } });
	});

	it("returns the same reference when the acknowledged commandId matches nothing pending -- a no-op, not a defensive rebuild", () => {
		const current: Readonly<Record<string, PendingRename>> = { "workspace-1": { title: "New Title", commandId: commandId("cmd-1") } };
		const next = pruneAcknowledgedRename(current, commandId("cmd-unrelated"));
		expect(next).toBe(current);
	});

	// The regression this whole module exists to fix: a real second writer
	// (most commonly an Agent Integration session sharing this same
	// Workspace, see agent-command-tool.ts) renames to a *different* title
	// before this client's own dispatch is acknowledged. A title-equality
	// reconciliation (`entry.title === pending.title`) would never match
	// again once that happens, leaving the human's own stale optimistic
	// override in place forever and masking the agent's real, newer title.
	it("prunes correctly even when a concurrent writer's own differing rename has already superseded this client's own optimistic title", () => {
		const humanCommandId = commandId("cmd-human");
		const current: Readonly<Record<string, PendingRename>> = { "workspace-1": { title: "Human's Title", commandId: humanCommandId } };
		// The agent's own rename applied and was acknowledged first, under a
		// different commandId -- the confirmed WorldViewModel this client now
		// renders already shows "Agent's Title", not "Human's Title", by the
		// time the human's own dispatch is finally acknowledged.
		const next = pruneAcknowledgedRename(current, humanCommandId);
		expect(next).toEqual({});
		// The catalog's own fallback (`pendingRenames[id]?.title ?? entry.title`)
		// now reads straight through to the confirmed WorldViewModel's real
		// "Agent's Title" instead of a masking override -- this test only
		// proves the overlay itself no longer blocks that; App.tsx's own
		// catalog memo is what actually reads through, exercised end-to-end by
		// workspace-catalog-lifecycle.spec.ts.
	});
});
