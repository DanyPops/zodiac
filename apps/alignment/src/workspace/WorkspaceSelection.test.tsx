/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { WorkspaceSelection } from "./WorkspaceSelection.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderCollapsed(execute = vi.fn()) {
	const registry = createCommandRegistry({
		commands: [
			{ id: "workspace.toggleSelection", title: "Toggle workspace selection", description: "", execute },
			{ id: "surface.showConversation", title: "Show conversation", description: "", execute: vi.fn() },
			{ id: "surface.showActivity", title: "Show activity", description: "", execute: vi.fn() },
			{ id: "palette.open", title: "Open command palette", description: "", execute: vi.fn() },
			{ id: "shortcuts.open", title: "Open keyboard shortcuts", description: "", execute: vi.fn() },
			{ id: "theme.cycle", title: "Cycle color theme", description: "", execute: vi.fn() },
		],
		bindings: [{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" }],
	});
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<WorkspaceSelection
				collapsed
				conversations={[]}
				loading={false}
				activeDomain="conversation"
				selectionRef={createRef()}
				selectedButtonRef={createRef()}
				onConversationFocus={vi.fn()}
			/>
		</CommandProvider>,
	);
	return { execute };
}

describe("collapsed Workspace quick selection", () => {
	it("overlays the Alignment logo and expand glyph in one control at the same height as the expanded header", () => {
		renderCollapsed();
		const toggle = screen.getByRole("button", { name: "Expand workspace selection" });
		expect(toggle).toHaveClass("h-12");
		expect(within(toggle).getByText("A")).toBeInTheDocument();
		expect(toggle.querySelector("svg")).not.toBeNull();
	});

	it("executes the same toggle command as the expanded Hide control", async () => {
		const { execute } = renderCollapsed();
		const toggle = screen.getByRole("button", { name: "Expand workspace selection" });
		toggle.click();
		expect(execute).toHaveBeenCalledOnce();
	});

	it("exposes its keyboard shortcut through the shared tooltip pattern", () => {
		renderCollapsed();
		const toggle = screen.getByRole("button", { name: "Expand workspace selection" });
		expect(toggle).toHaveAttribute("aria-keyshortcuts", "Control+B");
	});
});
