/**
 * A fresh, collision-resistant id for a Window/Surface created inside one
 * WorldStore instance -- a plain incrementing counter, the same technique
 * the existing React-owned Workspace model uses, without pulling in a uuid
 * dependency for a single counter's worth of need. Scoped per store
 * instance (not module-level global state), so two independent stores
 * (e.g. two tests) never share a counter. `startAt` lets a store rehydrated
 * from a snapshot resume past whatever ids that snapshot already used,
 * instead of colliding with them.
 */
export function createIdSequence(prefix: string, startAt = 0): () => string {
	let counter = startAt;
	return () => {
		counter += 1;
		return `${prefix}-${counter}`;
	};
}

/** The highest numeric suffix among `${prefix}-N` ids, or 0 if none match -- used to seed a rehydrated store's sequence past a snapshot's existing ids. */
export function highestIdSuffix(ids: readonly string[], prefix: string): number {
	const pattern = new RegExp(`^${prefix}-(\\d+)$`);
	let highest = 0;
	for (const id of ids) {
		const match = pattern.exec(id);
		if (match?.[1]) highest = Math.max(highest, Number(match[1]));
	}
	return highest;
}
