import type { CommandId } from "@zodiac/protocol";

/** An array-shaped optimistic overlay entry (pendingWorkspaces, pendingDockedSurfaces), tagged with the exact CommandId its own dispatch carried. */
export interface Acknowledgeable {
	readonly commandId: CommandId;
}

/**
 * Drops an item from an array-shaped optimistic overlay the instant its own
 * commandId is acknowledged by the daemon -- regardless of whether the
 * entity it describes still exists in the confirmed WorldViewModel by then.
 *
 * pendingWorkspaces and pendingDockedSurfaces both also prune by *id
 * presence* in the confirmed state (isConfirmedInViewModel / isDockConfirmed
 * in App.tsx) -- sound for the ordinary case, but not for a real race: a
 * Workspace (or docked Surface) created and then genuinely removed --
 * by this same client closing it before its own create's SSE echo lands,
 * or by a concurrent second writer (most commonly an Agent Integration
 * session, see agent-command-tool.ts) removing it first -- before this
 * client ever observes an intermediate render where the id is present.
 * `isConfirmedInViewModel` never becomes true for an id that (from this
 * client's own observation) never existed, so the pending entry would sit
 * in state forever, a permanent zombie in the catalog.
 *
 * This is the exact same class of bug pending-rename.ts's
 * pruneAcknowledgedRename fixes for value-equality reconciliation,
 * generalized to an array-shaped overlay: "my own dispatch was applied" is
 * the only thing this client needs to know to stop showing its own
 * optimistic guess. Kept *alongside* the existing id-presence check, not
 * as a replacement for it -- id-presence is a useful robustness net for a
 * missed acknowledgement (e.g. a brief SSE reconnect gap), so pruning
 * fires on whichever of the two conditions is met first.
 */
export function pruneAcknowledgedItem<T extends Acknowledgeable>(current: readonly T[], acknowledgedCommandId: CommandId): readonly T[] {
	const next = current.filter((item) => item.commandId !== acknowledgedCommandId);
	return next.length === current.length ? current : next;
}
