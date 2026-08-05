/**
 * Framework-neutral command dispatcher: the same typed handler runs whether
 * invoked directly (`execute`), by a keybinding (`dispatch`/`resolve`), or
 * introspected (`bindingFor`/`commands`/`bindings`) -- one path for a
 * graphical control, a keymap, a command palette, a script/RPC call, and an
 * agent action, per the IWE architecture's "Command" concept. Generic over
 * `TContext` so a specific host (Alignment's own workspace-selection/canvas/
 * surface/... vocabulary) supplies its own context union without this
 * module knowing what a "context" even means for that host.
 */
export interface CommandDefinition {
	id: string;
	title: string;
	description: string;
	execute: (...args: unknown[]) => void;
	enabled?: () => boolean;
}

export interface KeybindingDefinition<TContext extends string> {
	commandId: string;
	keys: string;
	context: TContext;
	source?: "default" | "user";
}

export interface CommandDispatcherOptions<TContext extends string> {
	commands: readonly CommandDefinition[];
	bindings: readonly KeybindingDefinition<TContext>[];
	/** Bindings in `userBindings` override a default binding for the same commandId+context; anything not overridden from `bindings` is kept, tagged `source: "default"`. */
	userBindings?: readonly KeybindingDefinition<TContext>[];
}

export interface CommandDispatcher<TContext extends string> {
	execute(commandId: string, ...args: unknown[]): boolean;
	dispatch(keys: string, activeContexts: readonly TContext[]): boolean;
	resolve(keys: string, activeContexts: readonly TContext[]): CommandDefinition | undefined;
	/** Searches `activeContexts` in order first; falls back to any binding for `commandId` in any context if none of `activeContexts` has one. An empty (or omitted) `activeContexts` goes straight to that fallback. */
	bindingFor(commandId: string, activeContexts?: readonly TContext[]): KeybindingDefinition<TContext> | undefined;
	commands(): readonly CommandDefinition[];
	bindings(): readonly KeybindingDefinition<TContext>[];
}

function normalizeKeys(keys: string): string {
	return keys.replaceAll(" ", "").toLowerCase();
}

export function createCommandDispatcher<TContext extends string>(options: CommandDispatcherOptions<TContext>): CommandDispatcher<TContext> {
	const commandsById = new Map<string, CommandDefinition>();
	for (const command of options.commands) {
		if (commandsById.has(command.id)) throw new Error(`Duplicate command id: ${command.id}`);
		commandsById.set(command.id, command);
	}

	const userBindings = options.userBindings ?? [];
	const overridden = new Set(userBindings.map((binding) => `${binding.commandId}:${binding.context}`));
	const bindings: KeybindingDefinition<TContext>[] = [
		...options.bindings.filter((binding) => !overridden.has(`${binding.commandId}:${binding.context}`)).map((binding) => ({ ...binding, source: binding.source ?? ("default" as const) })),
		...userBindings.map((binding) => ({ ...binding, source: "user" as const })),
	];

	const occupied = new Map<string, string>();
	for (const binding of bindings) {
		if (!commandsById.has(binding.commandId)) throw new Error(`Keybinding references unknown command: ${binding.commandId}`);
		const slot = `${binding.context}:${normalizeKeys(binding.keys)}`;
		const existing = occupied.get(slot);
		if (existing) throw new Error(`Keybinding conflict in ${binding.context}: ${binding.keys} binds both ${existing} and ${binding.commandId}`);
		occupied.set(slot, binding.commandId);
	}

	function execute(commandId: string, ...args: unknown[]): boolean {
		const command = commandsById.get(commandId);
		if (!command || command.enabled?.() === false) return false;
		command.execute(...args);
		return true;
	}

	function resolve(keys: string, activeContexts: readonly TContext[]): CommandDefinition | undefined {
		const normalized = normalizeKeys(keys);
		for (const context of activeContexts) {
			const binding = bindings.find((candidate) => candidate.context === context && normalizeKeys(candidate.keys) === normalized);
			if (binding) return commandsById.get(binding.commandId);
		}
		return undefined;
	}

	return {
		execute,
		dispatch(keys, activeContexts) {
			const command = resolve(keys, activeContexts);
			return command ? execute(command.id) : false;
		},
		resolve,
		bindingFor(commandId, activeContexts = []) {
			for (const context of activeContexts) {
				const binding = bindings.find((candidate) => candidate.commandId === commandId && candidate.context === context);
				if (binding) return binding;
			}
			return bindings.find((binding) => binding.commandId === commandId);
		},
		commands: () => [...commandsById.values()],
		bindings: () => [...bindings],
	};
}
