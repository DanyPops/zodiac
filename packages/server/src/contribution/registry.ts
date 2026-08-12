/**
 * A package-owned contribution registry -- the runtime home for whatever a
 * trusted package activates into a host: build-time-fixed lists
 * (`registerIntegration`/`registerCommand`) plus runtime lifecycle
 * events (`on`), modeled directly on Pi's own ExtensionAPI shape. Generic
 * over the host's own Integration, command, and lifecycle-event
 * shapes so this module stays framework/domain neutral -- a host's own
 * richer Integration definition (which may carry a React icon/render)
 * never needs to be known here.
 *
 * Deliberately scoped to registration + lifecycle events only: discovery
 * (finding contributions to load) and a real sandboxed execution boundary
 * are out of scope -- a contribution today is a plain in-process object a
 * caller already holds a reference to, activated with the same trust as
 * the host's own built-ins, not loaded from an untrusted source.
 */
export interface ContributionApi<TIntegration extends { id: string }, TCommand extends { id: string }, TEvent extends { type: string }> {
	registerIntegration: (definition: TIntegration) => void;
	registerCommand: (definition: TCommand) => void;
	on: <TType extends TEvent["type"]>(type: TType, handler: (event: Extract<TEvent, { type: TType }>) => void) => () => void;
}

export interface Contribution<TIntegration extends { id: string }, TCommand extends { id: string }, TEvent extends { type: string }> {
	id: string;
	activate: (api: ContributionApi<TIntegration, TCommand, TEvent>) => void;
}

export interface ContributionRegistry<TIntegration extends { id: string }, TCommand extends { id: string }, TEvent extends { type: string }> {
	register: (contribution: Contribution<TIntegration, TCommand, TEvent>) => void;
	emit: (event: TEvent) => void;
	integrations: () => readonly TIntegration[];
	commands: () => readonly TCommand[];
}

export function createContributionRegistry<TIntegration extends { id: string }, TCommand extends { id: string }, TEvent extends { type: string }>(): ContributionRegistry<TIntegration, TCommand, TEvent> {
	const integrations: TIntegration[] = [];
	const commands: TCommand[] = [];
	const listeners = new Map<TEvent["type"], Set<(event: TEvent) => void>>();
	const registeredContributionIds = new Set<string>();

	const api: ContributionApi<TIntegration, TCommand, TEvent> = {
		registerIntegration(definition) {
			if (integrations.some((existing) => existing.id === definition.id)) throw new Error(`Duplicate Integration id: ${definition.id}`);
			integrations.push(definition);
		},
		registerCommand(definition) {
			if (commands.some((existing) => existing.id === definition.id)) throw new Error(`Duplicate command id: ${definition.id}`);
			commands.push(definition);
		},
		on(type, handler) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			const wrapped = handler as (event: TEvent) => void;
			set.add(wrapped);
			return () => set.delete(wrapped);
		},
	};

	return {
		register(contribution) {
			if (registeredContributionIds.has(contribution.id)) throw new Error(`Contribution "${contribution.id}" is already registered`);
			registeredContributionIds.add(contribution.id);
			contribution.activate(api);
		},
		emit(event) {
			for (const handler of listeners.get(event.type) ?? []) handler(event);
		},
		integrations: () => [...integrations],
		commands: () => [...commands],
	};
}
