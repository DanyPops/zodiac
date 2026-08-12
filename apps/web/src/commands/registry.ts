import { createCommandDispatcher, type CommandDefinition, type CommandDispatcher, type KeybindingDefinition as CoreKeybindingDefinition } from "@alignment/server";

export type CommandContext = "global" | "workspace-selection" | "canvas" | "surface" | "text-input" | "dialog";
export type KeybindingSource = "default" | "user";

export type { CommandDefinition };
export type KeybindingDefinition = CoreKeybindingDefinition<CommandContext>;

export interface CommandRegistry extends CommandDispatcher<CommandContext> {
	bindingFor: (commandId: string, activeContexts?: readonly CommandContext[]) => KeybindingDefinition | undefined;
}

interface RegistryOptions {
	commands: readonly CommandDefinition[];
	bindings: readonly KeybindingDefinition[];
	userBindings?: readonly KeybindingDefinition[];
}

/** Priority order used only when a caller doesn't name its own active contexts -- Alignment's own most-specific-first vocabulary. `@alignment/server`'s dispatcher itself carries no opinion about what a "context" means for a given host. */
const DEFAULT_CONTEXT_PRIORITY: readonly CommandContext[] = ["dialog", "text-input", "workspace-selection", "surface", "canvas", "global"];

export function createCommandRegistry(options: RegistryOptions): CommandRegistry {
	const dispatcher = createCommandDispatcher<CommandContext>(options);
	return {
		...dispatcher,
		bindingFor: (commandId, activeContexts = DEFAULT_CONTEXT_PRIORITY) => dispatcher.bindingFor(commandId, activeContexts),
	};
}
