/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

function renderCollapsed(execute = vi.fn(), toolCallWorkspaceId?: string, onCreateWorkspace = vi.fn()) {
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
				onCreateWorkspace={onCreateWorkspace}
			/>
		</CommandProvider>,
	);
	return { execute, onCreateWorkspace };
}

function renderExpanded() {
	const registry = createCommandRegistry({
		commands: [
			{ id: "workspace.select", title: "Select Workspace", description: "", execute: vi.fn() },
			{ id: "palette.open", title: "Open command palette", description: "", execute: vi.fn() },
			{ id: "shortcuts.open", title: "Open keyboard shortcuts", description: "", execute: vi.fn() },
			{ id: "theme.cycle", title: "Cycle color theme", description: "", execute: vi.fn() },
			{ id: "appearance.open", title: "Open Settings", description: "", execute: vi.fn() },
		],
		bindings: [],
	});
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<WorkspaceSelection collapsed={false} catalog={WORKSPACE_CATALOG} activeWorkspaceId={WORKSPACE_CATALOG[0]!.id} selectionRef={createRef()} selectedButtonRef={createRef()} onWorkspaceFocus={vi.fn()} onCreateWorkspace={vi.fn()} />
		</CommandProvider>,
	);
}

describe("expanded Workspace selection", () => {
	it("keeps every action as its own icon, renamed to Settings for the appearance/umbrella one", () => {
		renderExpanded();
		expect(screen.getByRole("button", { name: "Command palette" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cycle color theme" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
	});

	it("gives every Workspace row's icon the same Glyph Badge, active or idle per selection", () => {
		renderExpanded();
		const activeRow = screen.getByRole("button", { name: WORKSPACE_CATALOG[0]!.title });
		const activeChip = activeRow.querySelector("span")!;
		expect(activeChip).toHaveClass("border-gray-300", "bg-gray-100", "text-gray-950");

		const idleRow = screen.getByRole("button", { name: WORKSPACE_CATALOG[1]!.title });
		const idleChip = idleRow.querySelector("span")!;
		expect(idleChip.className).not.toMatch(/(?<!:)border-gray-300|(?<!:)bg-gray-100/);
	});

	it("shows a 'New Workspace' affordance below the list that fires onCreateWorkspace", () => {
		const registry = createCommandRegistry({
			commands: [
				{ id: "workspace.select", title: "Select Workspace", description: "", execute: vi.fn() },
				{ id: "palette.open", title: "Open command palette", description: "", execute: vi.fn() },
				{ id: "shortcuts.open", title: "Open keyboard shortcuts", description: "", execute: vi.fn() },
				{ id: "theme.cycle", title: "Cycle color theme", description: "", execute: vi.fn() },
				{ id: "appearance.open", title: "Open Settings", description: "", execute: vi.fn() },
			],
			bindings: [],
		});
		const onCreateWorkspace = vi.fn();
		render(
			<CommandProvider registry={registry} activeContexts={["global"]}>
				<WorkspaceSelection collapsed={false} catalog={WORKSPACE_CATALOG} activeWorkspaceId={WORKSPACE_CATALOG[0]!.id} selectionRef={createRef()} selectedButtonRef={createRef()} onWorkspaceFocus={vi.fn()} onCreateWorkspace={onCreateWorkspace} />
			</CommandProvider>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Create a new Workspace" }));
		expect(onCreateWorkspace).toHaveBeenCalledOnce();
	});
});

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

	it("shows a 'Create a new Workspace' glyph that fires onCreateWorkspace", () => {
		const { onCreateWorkspace } = renderCollapsed();
		fireEvent.click(screen.getByRole("button", { name: "Create a new Workspace" }));
		expect(onCreateWorkspace).toHaveBeenCalledOnce();
	});

	it("folds Command Palette/Keyboard Shortcuts/Cycle Theme into one Settings entry, unlike the expanded footer's four separate icons", () => {
		renderCollapsed();
		expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Command palette" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Color theme" })).not.toBeInTheDocument();
	});

	it("places 'Create a new Workspace' directly after the last Workspace glyph, not pinned near the footer by leftover flex space", () => {
		renderCollapsed();
		const nav = screen.getByRole("navigation", { name: "Workspace quick selection" });
		const buttons = Array.from(nav.querySelectorAll("button"));
		const lastGlyphIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === WORKSPACE_CATALOG[WORKSPACE_CATALOG.length - 1]!.title);
		const createIndex = buttons.findIndex((button) => button.getAttribute("aria-label") === "Create a new Workspace");
		expect(lastGlyphIndex).toBeGreaterThanOrEqual(0);
		expect(createIndex).toBe(lastGlyphIndex + 1);
	});

	it("gives every Workspace glyph the same Glyph Badge treatment -- a bordered, filled chip when active, flush and muted when idle", () => {
		renderCollapsed();
		const active = screen.getByRole("button", { name: WORKSPACE_CATALOG[0]!.title });
		expect(active).toHaveClass("border-gray-300", "bg-gray-100", "text-gray-950");

		const idle = screen.getByRole("button", { name: WORKSPACE_CATALOG[1]!.title });
		expect(idle.className).not.toMatch(/(?<!:)border-gray-300|(?<!:)bg-gray-100/);
	});
});
