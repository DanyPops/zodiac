import type { CommandId } from "@zodiac/protocol";

/** One in-flight optimistic workspace.rename, keyed by the exact CommandId this client dispatched it with. */
export interface PendingRename {
	readonly title: string;
	readonly commandId: CommandId;
}

/**
 * Drops a pending rename the instant its own commandId is acknowledged by
 * the daemon -- regardless of what title the confirmed WorldViewModel
 * actually shows by then.
 *
 * The straightforward-looking alternative -- prune once the confirmed
 * title matches what this client optimistically guessed
 * (`entry.title === pending.title`) -- is unsound under a real second
 * writer. Zodiac's own Agent Integration tool
 * (packages/pi/src/agent-command-tool.ts) dispatches through the identical
 * `/api/world/commands` endpoint a human UI action uses, sharing the same
 * Workspace an agent session is granted against while a human is looking
 * at it live -- the single most common concurrent-writer scenario this
 * system has. If that agent's own rename lands with a *different* title
 * before or as this client's own round trip completes, a title-equality
 * check never matches again: the stale optimistic override sits in state
 * forever, masking the other writer's real, newer title from this
 * client's own render indefinitely.
 *
 * Acknowledging by commandId means "my own dispatch was applied" is the
 * only thing this client ever needs to know to stop overriding the
 * catalog's own render. Whatever title is authoritative afterwards --
 * this client's own, or another writer's that landed first -- is the live
 * WorldViewModel's job to show, not this overlay's.
 */
export function pruneAcknowledgedRename(current: Readonly<Record<string, PendingRename>>, acknowledgedCommandId: CommandId): Readonly<Record<string, PendingRename>> {
	const next = Object.fromEntries(Object.entries(current).filter(([, pending]) => pending.commandId !== acknowledgedCommandId));
	return Object.keys(next).length === Object.keys(current).length ? current : next;
}
