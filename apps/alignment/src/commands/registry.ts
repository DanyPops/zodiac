export type CommandContext = "global" | "workspace-selection" | "canvas" | "surface" | "text-input" | "dialog";
export type KeybindingSource = "default" | "user";

export interface CommandDefinition {
	id: string;
	title: string;
	description: string;
	execute: (...args: unknown[]) => void;
	enabled?: () => boolean;
}

export interface KeybindingDefinition {
	commandId: string;
	keys: string;
	context: CommandContext;
	source?: KeybindingSource;
}

export interface CommandRegistry {
	execute: (commandId: string, ...args: unknown[]) => boolean;
	dispatch: (keys: string, activeContexts: readonly CommandContext[]) => boolean;
	resolve: (keys: string, activeContexts: readonly CommandContext[]) => CommandDefinition | undefined;
	bindingFor: (commandId: string, activeContexts?: readonly CommandContext[]) => KeybindingDefinition | undefined;
	commands: () => readonly CommandDefinition[];
	bindings: () => readonly KeybindingDefinition[];
}

interface RegistryOptions {
	commands: readonly CommandDefinition[];
	bindings: readonly KeybindingDefinition[];
	userBindings?: readonly KeybindingDefinition[];
}

export function createCommandRegistry(options: RegistryOptions): CommandRegistry {
	const commandsById = new Map<string, CommandDefinition>();
	for (const command of options.commands) {
		if (commandsById.has(command.id)) throw new Error(`Duplicate command id: ${command.id}`);
		commandsById.set(command.id, command);
	}

	const userBindings = options.userBindings ?? [];
	const overridden = new Set(userBindings.map((binding) => `${binding.commandId}:${binding.context}`));
	const bindings = [
		...options.bindings
			.filter((binding) => !overridden.has(`${binding.commandId}:${binding.context}`))
			.map((binding) => ({ ...binding, source: binding.source ?? ("default" as const) })),
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

	function resolve(keys: string, activeContexts: readonly CommandContext[]): CommandDefinition | undefined {
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
		bindingFor(commandId, activeContexts = ["dialog", "text-input", "workspace-selection", "surface", "canvas", "global"]) {
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

function normalizeKeys(keys: string): string {
	return keys.replaceAll(" ", "").toLowerCase();
}
