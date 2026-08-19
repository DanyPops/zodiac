import type { CommandIntent } from "@zodiac/protocol";

/** What a cue is attached to -- a real, already-addressable domain/UI element, never a raw CSS selector or DOM path (this repo's own established boundary: no computer-use-style raw DOM access for an agent). */
export interface CueTarget {
	readonly kind: string;
	readonly id: string;
}

/**
 * What running a cue actually does. Baked in fully at registration time (the
 * static tier this task scopes to) -- a component registers a cue only once
 * it already knows the exact real effect its own human-facing action would
 * produce, so there is nothing left to fill in at run time.
 *
 * "command-intent": dispatches a real, already-fully-formed CommandIntent
 * through the same WorldStore apply() path a human action already uses.
 * "local-command": invokes an existing named entry in apps/web's own
 * command registry (createZodiacCommandRegistry) -- for actions that were
 * never going to be a WorldStore CommandIntent (open a dialog, focus
 * something). Omitted entirely: purely cosmetic, runs the definition's own
 * `run()` instead.
 */
export type CueEffect = { readonly kind: "command-intent"; readonly intent: CommandIntent } | { readonly kind: "local-command"; readonly commandId: string };

export interface CueDefinition {
	readonly cue: string;
	readonly description: string;
	readonly effect?: CueEffect;
	/**
	 * Only meaningful when `effect` is omitted -- the cosmetic action itself
	 * (highlight/pulse/scroll-to). Must resolve only once its own real DOM
	 * `transitionend`/`animationend` fires, never a fixed timer (this repo's
	 * own `window-carousel-fade.ts` discipline).
	 */
	readonly run?: () => Promise<void>;
}

export interface RegisteredCue extends CueTarget, CueDefinition {}

/** What runCue needs to actually carry out a `command-intent`/`local-command` effect -- injected by the caller (the cue player, apps/web-side), never held as module-level state here. Mirrors this repo's own established DI convention (useWorldClient's injectable fetcher, etc.) -- @zodiac/ui never holds a live WorldStore/command-registry reference itself. */
export interface CueDispatch {
	readonly applyCommandIntent: (intent: CommandIntent) => void;
	readonly executeLocalCommand: (commandId: string) => void;
}

const registry = new Map<string, RegisteredCue>();

/** Registers one cue target. Throws on a duplicate id -- mirrors WebMCP's own duplicate-name InvalidStateError and this repo's own createContributionRegistry's duplicate-id throw -- rather than silently overwriting a previous registration. Returns an unregister function; call it (e.g. from a component's own unmount cleanup) when the target stops being real. */
export function registerCue(target: CueTarget, definition: CueDefinition): () => void {
	if (registry.has(target.id)) throw new Error(`registerCue: a cue is already registered for target id "${target.id}"`);
	registry.set(target.id, { ...target, ...definition });
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		registry.delete(target.id);
	};
}

/** Read-only discovery -- mirrors WebMCP's own getTools(). */
export function listCues(): readonly RegisteredCue[] {
	return [...registry.values()];
}

/** Runs one registered cue by its target id. Rejects for an id nothing is currently registered under, rather than silently doing nothing -- a stale/removed target is a real, reportable condition, not a no-op. */
export async function runCue(targetId: string, dispatch: CueDispatch): Promise<void> {
	const entry = registry.get(targetId);
	if (!entry) throw new Error(`runCue: no cue registered for target id "${targetId}"`);
	if (entry.effect?.kind === "command-intent") {
		dispatch.applyCommandIntent(entry.effect.intent);
		return;
	}
	if (entry.effect?.kind === "local-command") {
		dispatch.executeLocalCommand(entry.effect.commandId);
		return;
	}
	await entry.run?.();
}
