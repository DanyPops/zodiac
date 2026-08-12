import { useState } from "react";
import type { Preferences } from "../platform/preferences.js";
import { DEFAULT_BINDINGS } from "./defaults.js";
import { createCommandRegistry, type CommandDefinition, type KeybindingDefinition } from "./registry.js";

export interface KeybindingOverrides {
	userBindings: readonly KeybindingDefinition[];
	/** Validates and persists a rebind; returns an error message instead of throwing when the shortcut is invalid or conflicts. */
	rebind: (commandId: string, hotkey: string, commands: readonly CommandDefinition[]) => string | undefined;
}

function replaceBinding(current: readonly KeybindingDefinition[], commandId: string, context: KeybindingDefinition["context"], keys: string): KeybindingDefinition[] {
	return [
		...current.filter((binding) => !(binding.commandId === commandId && binding.context === context)),
		{ commandId, keys, context, source: "user" },
	];
}

export function useKeybindingOverrides(preferences: Preferences): KeybindingOverrides {
	const [userBindings, setUserBindings] = useState<KeybindingDefinition[]>(() => preferences.keybindingOverrides());

	return {
		userBindings,
		rebind(commandId, hotkey, commands) {
			const defaultBinding = DEFAULT_BINDINGS.find((binding) => binding.commandId === commandId);
			if (!defaultBinding) return "This command is not bindable.";

			const next = replaceBinding(userBindings, commandId, defaultBinding.context, hotkey);
			try {
				createCommandRegistry({ commands, bindings: DEFAULT_BINDINGS, userBindings: next });
			} catch (error) {
				return error instanceof Error ? error.message : "That shortcut conflicts with an existing binding.";
			}

			preferences.setKeybindingOverrides(next);
			setUserBindings(next);
			return undefined;
		},
	};
}
