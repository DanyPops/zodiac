import { describe, expect, it } from "vitest";
import { commandId } from "@zodiac/protocol";
import { pruneAcknowledgedItem, type Acknowledgeable } from "./pending-overlay.js";

interface Item extends Acknowledgeable {
	readonly id: string;
	readonly title: string;
}

describe("pruneAcknowledgedItem", () => {
	it("drops the item whose own commandId was just acknowledged", () => {
		const current: readonly Item[] = [{ id: "w1", title: "Workspace One", commandId: commandId("cmd-1") }];
		const next = pruneAcknowledgedItem(current, commandId("cmd-1"));
		expect(next).toEqual([]);
	});

	it("leaves every other pending item untouched", () => {
		const current: readonly Item[] = [
			{ id: "w1", title: "Workspace One", commandId: commandId("cmd-1") },
			{ id: "w2", title: "Workspace Two", commandId: commandId("cmd-2") },
		];
		const next = pruneAcknowledgedItem(current, commandId("cmd-1"));
		expect(next).toEqual([{ id: "w2", title: "Workspace Two", commandId: commandId("cmd-2") }]);
	});

	it("returns the same reference when the acknowledged commandId matches nothing pending -- a no-op, not a defensive rebuild", () => {
		const current: readonly Item[] = [{ id: "w1", title: "Workspace One", commandId: commandId("cmd-1") }];
		const next = pruneAcknowledgedItem(current, commandId("cmd-unrelated"));
		expect(next).toBe(current);
	});

	// The regression this module exists to close: a Workspace (or docked
	// Surface) created and then genuinely removed -- by a concurrent second
	// writer, most commonly an Agent Integration session sharing the same
	// Workspace (see agent-command-tool.ts) -- before this client ever
	// observes an intermediate confirmed-present render for it. An
	// id-presence check (isConfirmedInViewModel/isDockConfirmed in App.tsx)
	// alone would never prune this: the id never appears "confirmed present"
	// from this client's own point of view, so the pending entry would sit
	// in state forever, a permanent zombie row in the catalog.
	it("prunes correctly even when the entity was removed by a concurrent writer before this client ever observed it as confirmed-present", () => {
		const creatorsOwnCommandId = commandId("cmd-create");
		const current: readonly Item[] = [{ id: "w1", title: "Scratch Workspace", commandId: creatorsOwnCommandId }];
		// The daemon applied both the create and a near-simultaneous remove
		// from another writer; this client's own commandId is still
		// acknowledged (the daemon did apply it, if only briefly) even though
		// isConfirmedInViewModel(id) would never have returned true for "w1".
		const next = pruneAcknowledgedItem(current, creatorsOwnCommandId);
		expect(next).toEqual([]);
	});
});
