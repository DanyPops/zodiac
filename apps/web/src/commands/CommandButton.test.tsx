/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "./registry.js";
import { CommandButton, CommandProvider } from "./react.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderCommandControl(keys = "Mod+B", execute = vi.fn()) {
	const registry = createCommandRegistry({
		commands: [{ id: "test.command", title: "Test command", description: "Runs the test command.", execute }],
		bindings: [{ commandId: "test.command", keys, context: "global" }],
	});
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<input aria-label="Typing context" />
			<CommandButton commandId="test.command" label="Run test command">Run</CommandButton>
		</CommandProvider>,
	);
	return { execute };
}

describe("CommandButton", () => {
	it("uses one command path for click and keyboard activation", async () => {
		const user = userEvent.setup();
		const { execute } = renderCommandControl();
		await user.click(screen.getByRole("button", { name: "Run test command" }));
		await user.keyboard("{Control>}b{/Control}");
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it("exposes the resolved binding to assistive technology and on hover", async () => {
		const user = userEvent.setup();
		renderCommandControl();
		const button = screen.getByRole("button", { name: "Run test command" });
		expect(button).toHaveAttribute("aria-keyshortcuts", "Control+B");
		await user.hover(button);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Run test command");
		expect(screen.getByRole("tooltip")).toHaveTextContent("Ctrl+B");
	});

	it("reveals the same hint when reached by keyboard focus", async () => {
		const user = userEvent.setup();
		renderCommandControl();
		await user.tab();
		await user.tab();
		expect(screen.getByRole("button", { name: "Run test command" })).toHaveFocus();
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Ctrl+B");
	});

	it("composes an externally-supplied onClick with command execution rather than one silently replacing the other", async () => {
		// Regression test: wrapping a CommandButton in Radix's Tooltip.Trigger
		// asChild (see PillarTooltip.tsx) clones an onClick handler onto it at
		// runtime, bypassing CommandButtonProps' own type -- a plain
		// `onClick={...} {...props}` ordering let that runtime-injected handler
		// silently replace command execution. An explicit onClick prop is the
		// same collision, reproducible without pulling in Radix at all.
		const user = userEvent.setup();
		const execute = vi.fn();
		const externalOnClick = vi.fn();
		const registry = createCommandRegistry({
			commands: [{ id: "test.command", title: "Test command", description: "", execute }],
			bindings: [],
		});
		render(
			<CommandProvider registry={registry} activeContexts={["global"]}>
				<CommandButton commandId="test.command" label="Run test command" onClick={externalOnClick}>
					Run
				</CommandButton>
			</CommandProvider>,
		);
		await user.click(screen.getByRole("button", { name: "Run test command" }));
		expect(externalOnClick).toHaveBeenCalledOnce();
		expect(execute).toHaveBeenCalledOnce();
	});

	it("keeps modifier commands active while a text input owns focus", async () => {
		const user = userEvent.setup();
		const { execute } = renderCommandControl("Mod+Alt+L");
		await user.click(screen.getByRole("textbox", { name: "Typing context" }));
		await user.keyboard("{Control>}{Alt>}l{/Alt}{/Control}");
		expect(execute).toHaveBeenCalledOnce();
	});
});
