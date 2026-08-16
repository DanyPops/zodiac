/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "./registry.js";
import { CommandProvider } from "./react.js";
import { CommandDialog } from "./CommandDialog.js";
import type { DialogMode } from "./useCommandContextStack.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderDialog(mode: "palette" | "shortcuts", overrides: { readonly onModeChange?: (mode: DialogMode) => void; readonly disabledEnabled?: boolean } = {}) {
	const execute = vi.fn();
	const onModeChange = overrides.onModeChange ?? vi.fn();
	const registry = createCommandRegistry({
		commands: [
			{ id: "test.run", title: "Run tests", description: "Runs the test suite.", execute },
			{ id: "test.disabled", title: "Disabled command", description: "Never enabled.", execute: vi.fn(), enabled: () => overrides.disabledEnabled ?? false },
		],
		bindings: [{ commandId: "test.run", keys: "Mod+R", context: "global" }],
	});
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<CommandDialog mode={mode} onModeChange={onModeChange} onRebind={() => undefined} />
		</CommandProvider>,
	);
	return { execute, onModeChange };
}

describe("CommandDialog", () => {
	describe("palette mode", () => {
		it("shows the query input and every command, with its own formatted binding", () => {
			renderDialog("palette");
			expect(screen.getByRole("textbox", { name: "Filter commands" })).toBeInTheDocument();
			expect(screen.getByRole("option", { name: "Run tests" })).toBeInTheDocument();
			expect(screen.getByRole("option", { name: "Run tests" })).toHaveTextContent("Ctrl+R");
			expect(screen.getByRole("option", { name: "Disabled command" })).toHaveTextContent("Unbound");
		});

		it("filters commands by typing", () => {
			renderDialog("palette");
			fireEvent.change(screen.getByRole("textbox", { name: "Filter commands" }), { target: { value: "run" } });
			expect(screen.getByRole("option", { name: "Run tests" })).toBeInTheDocument();
			expect(screen.queryByRole("option", { name: "Disabled command" })).not.toBeInTheDocument();
		});

		it("renders a command whose own enabled() is false as disabled", () => {
			renderDialog("palette");
			expect(screen.getByRole("option", { name: "Disabled command" })).toBeDisabled();
			expect(screen.getByRole("option", { name: "Run tests" })).toBeEnabled();
		});

		it("clicking an enabled command executes it and closes the dialog", () => {
			const { execute, onModeChange } = renderDialog("palette");
			fireEvent.click(screen.getByRole("option", { name: "Run tests" }));
			expect(execute).toHaveBeenCalledOnce();
			expect(onModeChange).toHaveBeenCalledWith(null);
		});
	});

	describe("shortcuts mode", () => {
		it("hides the query input -- shortcuts browses the fixed list, it isn't filtered", () => {
			renderDialog("shortcuts");
			expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
		});

		it("labels each row for rebinding, not for execution", () => {
			renderDialog("shortcuts");
			expect(screen.getByRole("option", { name: "Change shortcut for Run tests" })).toBeInTheDocument();
		});

		it("a disabled command is still rebindable -- enabled() only gates palette execution", () => {
			renderDialog("shortcuts");
			expect(screen.getByRole("option", { name: "Change shortcut for Disabled command" })).toBeEnabled();
		});

		it("clicking a row starts rebinding instead of executing or closing the dialog", () => {
			const { execute, onModeChange } = renderDialog("shortcuts");
			fireEvent.click(screen.getByRole("option", { name: "Change shortcut for Run tests" }));
			expect(execute).not.toHaveBeenCalled();
			expect(onModeChange).not.toHaveBeenCalled();
		});
	});
});
