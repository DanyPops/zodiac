import { describe, expect, it, vi } from "vitest";
import { createCommandDispatcher, type CommandDefinition, type KeybindingDefinition } from "./dispatcher.js";

type Context = "global" | "surface" | "text-input";

function command(id: string, execute = vi.fn()): CommandDefinition {
	return { id, title: id, description: `Run ${id}`, execute };
}

describe("createCommandDispatcher", () => {
	it("uses one command path for direct and key-bound execution", () => {
		const execute = vi.fn();
		const dispatcher = createCommandDispatcher<Context>({
			commands: [command("workspace.toggleSelection", execute)],
			bindings: [{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" }],
		});

		dispatcher.execute("workspace.toggleSelection");
		dispatcher.dispatch("Mod+B", ["global"]);

		expect(execute).toHaveBeenCalledTimes(2);
		expect(dispatcher.bindingFor("workspace.toggleSelection", ["global"])?.keys).toBe("Mod+B");
	});

	it("gives the most-specific active context precedence over a broader one, by activeContexts order", () => {
		const globalAction = vi.fn();
		const surfaceAction = vi.fn();
		const bindings: KeybindingDefinition<Context>[] = [
			{ commandId: "global.action", keys: "Enter", context: "global" },
			{ commandId: "surface.action", keys: "Enter", context: "surface" },
		];
		const dispatcher = createCommandDispatcher<Context>({ commands: [command("global.action", globalAction), command("surface.action", surfaceAction)], bindings });

		dispatcher.dispatch("Enter", ["surface", "global"]);

		expect(surfaceAction).toHaveBeenCalledOnce();
		expect(globalAction).not.toHaveBeenCalled();
	});

	it("rejects a keybinding conflict in the same context", () => {
		expect(() =>
			createCommandDispatcher<Context>({
				commands: [command("one"), command("two")],
				bindings: [
					{ commandId: "one", keys: "Mod+K", context: "global" },
					{ commandId: "two", keys: "Mod+K", context: "global" },
				],
			}),
		).toThrow(/conflict/i);
	});

	it("rejects a duplicate command id", () => {
		expect(() => createCommandDispatcher<Context>({ commands: [command("dup"), command("dup")], bindings: [] })).toThrow(/duplicate command id/i);
	});

	it("rejects a keybinding referencing an unknown command", () => {
		expect(() => createCommandDispatcher<Context>({ commands: [], bindings: [{ commandId: "ghost", keys: "Mod+K", context: "global" }] })).toThrow(/unknown command/i);
	});

	it("applies a user override without mutating the defaults array", () => {
		const defaults: KeybindingDefinition<Context>[] = [{ commandId: "palette.open", keys: "Mod+K", context: "global", source: "default" }];
		const dispatcher = createCommandDispatcher<Context>({
			commands: [command("palette.open")],
			bindings: defaults,
			userBindings: [{ commandId: "palette.open", keys: "Mod+P", context: "global", source: "user" }],
		});

		expect(dispatcher.bindingFor("palette.open", ["global"])?.keys).toBe("Mod+P");
		expect(dispatcher.resolve("Mod+K", ["global"])).toBeUndefined();
		expect(defaults[0]?.keys).toBe("Mod+K");
	});

	it("does not execute a disabled command", () => {
		const execute = vi.fn();
		const dispatcher = createCommandDispatcher<Context>({
			commands: [{ ...command("conversation.send", execute), enabled: () => false }],
			bindings: [{ commandId: "conversation.send", keys: "Mod+Enter", context: "text-input" }],
		});

		expect(dispatcher.dispatch("Mod+Enter", ["text-input", "global"])).toBe(false);
		expect(execute).not.toHaveBeenCalled();
	});

	it("bindingFor with no activeContexts falls back to any binding for the command", () => {
		const dispatcher = createCommandDispatcher<Context>({ commands: [command("theme.cycle")], bindings: [{ commandId: "theme.cycle", keys: "Mod+Alt+L", context: "global" }] });
		expect(dispatcher.bindingFor("theme.cycle")?.keys).toBe("Mod+Alt+L");
	});

	it("bindingFor returns undefined for a command with no binding at all", () => {
		const dispatcher = createCommandDispatcher<Context>({ commands: [command("unbound")], bindings: [] });
		expect(dispatcher.bindingFor("unbound")).toBeUndefined();
	});
});
