/**
 * Shared, framework-neutral shapes for "pick one of several, filtered by a
 * query" interactive results -- the domain concept behind Zodiac Web's own
 * `<Picker>` (packages/ui) and, eventually, a terminal-side Malevich
 * binding (BorderedSelectPanel + SelectList) for the same concept, e.g. a
 * definition/references result. Not zod-validated like this package's
 * other exported shapes (see entities.ts): a PickerItem's own `value: T`
 * is an arbitrary, same-process payload (a CommandId today, a Lector file
 * location tomorrow), never a network/persisted payload crossing a real
 * trust boundary -- the same reasoning ParseResult<T> in result.ts already
 * follows for a comparable render-time-only generic, and view-models.ts
 * follows for its own plain, ungated render-time interfaces.
 *
 * DiagnosticEntry/DiffHunk+DiffLine/DagNode+DagEdge/DetailField+Section
 * are deliberately not defined yet -- `<Picker>` is the first, smallest
 * real consumer proving this seam; add each further shape only once its
 * own real React component exists to prove it too, per packages/ui's own
 * "don't build ahead of a real consumer" discipline (see DialogChrome's
 * history: extracted only once 7 real call sites hand-duplicated it).
 */
export interface PickerItem<T = unknown> {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly disabled?: boolean;
	readonly value: T;
}

export interface PickerRequest<T = unknown> {
	readonly title: string;
	readonly items: readonly PickerItem<T>[];
}
