/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { Activity } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { TemplatesDialog } from "./TemplatesDialog.js";
import type { SurfaceTemplateEntry } from "./useSurfaceTemplates.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

const ENTRIES: SurfaceTemplateEntry[] = [
	{ id: "activity", title: "Activity", icon: Activity, dockCommandId: "template.dockActivity", templateId: "activity", saved: false },
	{ id: "saved-1", title: "My Activity View", icon: Activity, dockCommandId: "template.dockActivity", templateId: "activity", saved: true },
];

function renderDialog(props: Partial<Parameters<typeof TemplatesDialog>[0]> = {}) {
	const registry = createCommandRegistry({ commands: [{ id: "dialog.close", title: "Close dialog", description: "Closes the open dialog.", execute: vi.fn() }], bindings: [] });
	const onDock = vi.fn();
	const onClose = vi.fn();
	render(
		<CommandProvider registry={registry} activeContexts={["dialog"]}>
			<TemplatesDialog open onClose={onClose} entries={ENTRIES} onDock={onDock} {...props} />
		</CommandProvider>,
	);
	return { onDock, onClose };
}

describe("TemplatesDialog", () => {
	it("filters the catalog by typing", () => {
		renderDialog();
		expect(screen.getByRole("button", { name: /^Activity$/ })).toBeInTheDocument();
		expect(screen.getByText("My Activity View")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Filter Surface Templates"), { target: { value: "My Activity" } });

		expect(screen.queryByRole("button", { name: /^Activity$/ })).not.toBeInTheDocument();
		expect(screen.getByText("My Activity View")).toBeInTheDocument();
	});

	it("marks saved templates distinctly from the built-in catalog", () => {
		renderDialog();
		const savedButton = screen.getByText("My Activity View").closest("button");
		expect(savedButton).toHaveTextContent("Saved");
	});

	it("selecting a template moves to the placement step, and each placement docks with the expected position", () => {
		const { onDock, onClose } = renderDialog();

		fireEvent.click(screen.getByRole("button", { name: /^Activity$/ }));
		expect(screen.getByText('Dock "Activity"')).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Split right" }));

		expect(onDock).toHaveBeenCalledWith("activity", "Activity", "right");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("'As a tab' docks with an undefined position (the docking engine's own default placement)", () => {
		const { onDock } = renderDialog();

		fireEvent.click(screen.getByRole("button", { name: /^Activity$/ }));
		fireEvent.click(screen.getByRole("button", { name: "As a tab" }));

		expect(onDock).toHaveBeenCalledWith("activity", "Activity", undefined);
	});
});
