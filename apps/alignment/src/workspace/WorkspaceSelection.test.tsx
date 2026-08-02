/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { WorkspaceSelection } from "./WorkspaceSelection.js";
import { WORKSPACE_CATALOG } from "./workspace-catalog.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderCollapsed(execute = vi.fn(), toolCallWorkspaceId?: string) {
	const registry = createCommandRegistry({
		commands: [
			{ id: "workspace.toggleSelection", title: "Toggle workspace selection", description: "", execute },
			{ id: "workspace.select", title: "Select Workspace", description: "", execute: vi.fn() },
			{ id: "palette.open", title: "Open command palette", description: "", execute: vi.fn() },
			{ id: "shortcuts.open", title: "Open keyboard shortcuts", description: "", execute: vi.fn() },
			{ id: "theme.cycle", title: "Cycle color theme", description: "", execute: vi.fn() },
			{ id: "appearance.open", title: "Open Visual DNA", description: "", execute: vi.fn() },
		],
		bindings: [{ commandId: "workspace.toggleSelection", keys: "Mod+B", context: "global" }],
	});
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<WorkspaceSelection
				collapsed
				catalog={WORKSPACE_CATALOG}
				activeWorkspaceId={WORKSPACE_CATALOG[0]!.id}
				selectionRef={createRef()}
				selectedButtonRef={createRef()}
				onWorkspaceFocus={vi.fn()}
				toolCallWorkspaceId={toolCallWorkspaceId}
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

	it("shows every catalog Workspace as its own glyph, distinct from a Conversation-derived initial", () => {
		renderCollapsed();
		for (const entry of WORKSPACE_CATALOG) {
			const button = screen.getByRole("button", { name: entry.title });
			expect(button.querySelector("svg")).not.toBeNull();
		}
	});

	it("marks the active Workspace via aria-current", () => {
		renderCollapsed();
		const active = screen.getByRole("button", { name: WORKSPACE_CATALOG[0]!.title });
		expect(active).toHaveAttribute("aria-current", "page");
		const inactive = screen.getByRole("button", { name: WORKSPACE_CATALOG[1]!.title });
		expect(inactive).not.toHaveAttribute("aria-current");
	});

	it("breathes continuously (the calm wisp-breathe animation, not Tailwind's default pulse) on the active Workspace, and only on hover/keyboard-focus for every other one", () => {
		renderCollapsed();
		const active = screen.getByRole("button", { name: WORKSPACE_CATALOG[0]!.title });
		expect(active).toHaveClass("animate-wisp-breathe");
		const inactive = screen.getByRole("button", { name: WORKSPACE_CATALOG[1]!.title });
		expect(inactive.className).not.toMatch(/(?<!:)animate-wisp-breathe/);
		expect(inactive).toHaveClass("hover:animate-wisp-breathe");
		expect(inactive).toHaveClass("focus-visible:animate-wisp-breathe");
		expect(inactive).toHaveClass("motion-reduce:animate-none");
	});

	it("rings and breathes whichever Workspace real tool-call telemetry says the agent is acting against, even if it isn't the active one", () => {
		renderCollapsed(vi.fn(), WORKSPACE_CATALOG[1]!.id);
		const target = screen.getByRole("button", { name: WORKSPACE_CATALOG[1]!.title });
		expect(target).toHaveClass("ring-2");
		expect(target).toHaveClass("ring-accent");
		expect(target).toHaveClass("animate-wisp-breathe");
	});

	it("shows no tool-call ring when nothing correlates", () => {
		renderCollapsed();
		for (const entry of WORKSPACE_CATALOG) expect(screen.getByRole("button", { name: entry.title })).not.toHaveClass("ring-accent");
	});
});
