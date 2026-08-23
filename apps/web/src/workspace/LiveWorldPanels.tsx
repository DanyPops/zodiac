import { useEffect, useRef } from "react";
import type { CommandId, CommandIntent, Panel, WorldViewModel } from "@zodiac/protocol";
import { useWorldClient } from "../world/use-world-client.js";

interface LiveWorldPanelsProps {
	readonly baseUrl: string;
	readonly onPanels: (panels: readonly Panel[]) => void;
	/** Called on every render with the current apply() -- a plain ref write on the caller's side, never a state update, so this doesn't cascade into a render loop despite apply's own identity changing every render (useWorldClient's own apply is a fresh closure each call, not memoized). */
	readonly onApply: (apply: (intent: CommandIntent) => void) => void;
	/** Optional: the full live WorldViewModel (Workspace catalog, activeWorkspaceId), for a caller that needs more than just Panel chrome -- the Workspace-authority cutover's own read side. Omitted entirely by a caller (like the pre-cutover App.tsx) that only cares about Panel placement. */
	readonly onWorldViewModel?: (viewModel: WorldViewModel) => void;
	/**
	 * Optional: fires once, in order, for each of this client's own dispatched
	 * commands the instant the daemon's own broadcast confirms it -- the
	 * multi-writer-safe way to retire an optimistic overlay (see App.tsx's own
	 * pendingRenames). Confirming by commandId, not by re-checking whether the
	 * viewModel now matches the value this client originally optimistically
	 * guessed, matters specifically once a second writer (most commonly an
	 * agent tool call sharing this same Workspace, dispatched through the
	 * identical /api/world/commands endpoint -- see agent-command-tool.ts)
	 * can supersede this client's own write before or as it lands: a
	 * value-equality check would then never match and the stale optimistic
	 * override would mask the other writer's real, newer value forever.
	 */
	readonly onCommandAcknowledged?: (commandId: CommandId) => void;
}

/**
 * An invisible bridge, not a visible piece of chrome -- lazy-loaded (see
 * App.tsx's own `lazy()` call for it) so `useWorldClient`'s real dependency
 * (`@zodiac/world`'s full WorldClient implementation) stays out
 * of the critical entry bundle, the same reasoning WindowDockview/
 * LiveDaemonPanel already apply. Reports the live Panel list up via
 * `onPanels` whenever it changes; App.tsx's own default chrome placement
 * (see applet-slots.ts) already covers the gap before this chunk loads or
 * connects, so there's nothing else for this component to render itself.
 */
export function LiveWorldPanels({ baseUrl, onPanels, onApply, onWorldViewModel, onCommandAcknowledged }: LiveWorldPanelsProps): null {
	const world = useWorldClient(baseUrl);
	useEffect(() => {
		onPanels(world.panels);
	}, [world.panels, onPanels]);
	useEffect(() => {
		onWorldViewModel?.(world.viewModel);
	}, [world.viewModel, onWorldViewModel]);
	// acknowledgedCommandIds is a bounded recent window (see
	// recordCommandAcknowledgement/MAX_RETAINED_COMMAND_ACKNOWLEDGEMENTS), not
	// an unbounded append-only log -- it can drop its oldest entries once full,
	// so a plain length-based "reported up to index N" cursor would misread a
	// trim as nothing-new (or worse, re-report an old id) once that bound is
	// ever hit. A Set of previously-seen ids, diffed fresh each change, stays
	// correct regardless of trimming.
	const previouslySeenRef = useRef<ReadonlySet<CommandId>>(new Set());
	useEffect(() => {
		if (!onCommandAcknowledged) return;
		const previouslySeen = previouslySeenRef.current;
		for (const id of world.acknowledgedCommandIds) if (!previouslySeen.has(id)) onCommandAcknowledged(id);
		previouslySeenRef.current = new Set(world.acknowledgedCommandIds);
	}, [world.acknowledgedCommandIds, onCommandAcknowledged]);
	// No dependency array, deliberately -- useWorldClient's own apply is a
	// fresh closure every render (never memoized), so "only when it changes"
	// would mean every render anyway; an effect (not a call during render)
	// keeps this a side effect, not a render-purity violation.
	useEffect(() => {
		onApply(world.apply);
	});
	return null;
}
