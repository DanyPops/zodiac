import { describe, expect, it, vi } from "vitest";
import { createAlignmentCommandRegistry, type AlignmentCommandActions } from "./defaults.js";
import { createCommandRegistry, type CommandDefinition, type KeybindingDefinition } from "./registry.js";

function command(id: string, execute = vi.fn()): CommandDefinition {
	return { id, title: id, description: `Run ${id}`, execute };
}

describe("Alignment command catalog", () => {
	it("gives every first-slice action an inspectable default binding", () => {
		const action = vi.fn();
		const actions: AlignmentCommandActions = {
			toggleWorkspaceSelection: action,
			focusWorkspaceSelection: action,
			focusCanvas: action,
			focusPreviousConversation: action,
			focusNextConversation: action,
			focusFirstConversation: action,
			focusLastConversation: action,
			showSurface: action,
			cycleTheme: action,
			sendMessage: action,
			openPalette: action,
			openShortcuts: action,
			closeDialog: action,
			openConversation: action,
			canSendMessage: () => true,
		};
		const registry = createAlignmentCommandRegistry(actions);
		for (const registered of registry.commands()) expect(registry.bindingFor(registered.id)).toBeDefined();
	});
});

describe("CommandRegistry", () => {
	it("uses one command path for direct and key-bound execution", () => {
		const execute = vi.fn();
		const registry = createCommandRegistry({
			commands: [command("workspace.toggleSelection", execute)],
			bindings: [{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" }],
		});

		registry.execute("workspace.toggleSelection");
		registry.dispatch("Mod+B", ["global"]);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(registry.bindingFor("workspace.toggleSelection", ["global"])?.keys).toBe("Mod+B");
	});

	it("gives the most-specific active context precedence over global", () => {
		const globalAction = vi.fn();
		const surfaceAction = vi.fn();
		const bindings: KeybindingDefinition[] = [
			{ commandId: "global.action", keys: "Enter", context: "global" },
			{ commandId: "surface.action", keys: "Enter", context: "surface" },
		];
		const registry = createCommandRegistry({
			commands: [command("global.action", globalAction), command("surface.action", surfaceAction)],
			bindings,
		});

		registry.dispatch("Enter", ["surface", "global"]);

		expect(surfaceAction).toHaveBeenCalledOnce();
		expect(globalAction).not.toHaveBeenCalled();
	});

	it("rejects conflicts in the same context", () => {
		expect(() =>
			createCommandRegistry({
				commands: [command("one"), command("two")],
				bindings: [
					{ commandId: "one", keys: "Mod+K", context: "global" },
					{ commandId: "two", keys: "Mod+K", context: "global" },
				],
			}),
		).toThrow(/conflict/i);
	});

	it("applies a user override without mutating defaults", () => {
		const defaults: KeybindingDefinition[] = [
			{ commandId: "palette.open", keys: "Mod+K", context: "global", source: "default" },
		];
		const registry = createCommandRegistry({
			commands: [command("palette.open")],
			bindings: defaults,
			userBindings: [{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }],
		});

		expect(registry.bindingFor("palette.open", ["global"])?.keys).toBe("Mod+P");
		expect(registry.resolve("Mod+K", ["global"])).toBeUndefined();
		expect(defaults[0]?.keys).toBe("Mod+K");
	});

	it("does not execute disabled commands", () => {
		const execute = vi.fn();
		const registry = createCommandRegistry({
			commands: [{ ...command("conversation.send", execute), enabled: () => false }],
			bindings: [{ commandId: "conversation.send", keys: "Mod+Enter", context: "text-input" }],
		});

		expect(registry.dispatch("Mod+Enter", ["text-input", "global"])).toBe(false);
		expect(execute).not.toHaveBeenCalled();
	});
});
