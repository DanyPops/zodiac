/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { Activity } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { SurfaceTemplatesPillar } from "./SurfaceTemplatesPillar.js";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
import type { SurfaceTemplateEntry } from "./useSurfaceTemplates.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

const ENTRIES: SurfaceTemplateEntry[] = [{ id: "activity", title: "Activity", icon: Activity, dockCommandId: "template.dockActivity", templateId: "activity", saved: false }];

function renderPillar(props: Partial<Parameters<typeof SurfaceTemplatesPillar>[0]> = {}) {
	const registry = createCommandRegistry({ commands: [{ id: "templates.open", title: "Browse Surface Templates", description: "d", execute: vi.fn() }], bindings: [] });
	const onDockDefault = vi.fn();
	const onSaveCurrentAsTemplate = vi.fn();
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<SurfaceTemplatesPillar entries={ENTRIES} onDockDefault={onDockDefault} canSaveCurrent={false} onSaveCurrentAsTemplate={onSaveCurrentAsTemplate} {...props} />
		</CommandProvider>,
	);
	return { onDockDefault, onSaveCurrentAsTemplate };
}

describe("SurfaceTemplatesPillar", () => {
	it("clicking a template glyph docks it with the default placement", () => {
		const { onDockDefault } = renderPillar();
		fireEvent.click(screen.getByRole("button", { name: "Dock Activity" }));
		expect(onDockDefault).toHaveBeenCalledWith("activity", "Activity");
	});

	it("a template glyph is draggable and carries its template id under the shared MIME type", () => {
		renderPillar();
		const glyph = screen.getByRole("button", { name: "Dock Activity" });
		expect(glyph).toHaveAttribute("draggable", "true");

		const dataTransfer = { setData: vi.fn() };
		fireEvent.dragStart(glyph, { dataTransfer });
		expect(dataTransfer.setData).toHaveBeenCalledWith(TEMPLATE_DRAG_MIME_TYPE, "activity");
	});

	it("the save-as-template control is disabled when there is nothing active to save", () => {
		renderPillar({ canSaveCurrent: false });
		expect(screen.getByRole("button", { name: "Save the active docked Surface as a new template" })).toBeDisabled();
	});

	it("saving a template with a non-blank title calls onSaveCurrentAsTemplate and closes the form", () => {
		const { onSaveCurrentAsTemplate } = renderPillar({ canSaveCurrent: true });
		fireEvent.click(screen.getByRole("button", { name: "Save the active docked Surface as a new template" }));

		const input = screen.getByLabelText("New template title");
		fireEvent.change(input, { target: { value: "My View" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(onSaveCurrentAsTemplate).toHaveBeenCalledWith("My View");
		expect(screen.queryByLabelText("New template title")).not.toBeInTheDocument();
	});

	it("Escape closes the save-as-template form without saving", () => {
		const { onSaveCurrentAsTemplate } = renderPillar({ canSaveCurrent: true });
		fireEvent.click(screen.getByRole("button", { name: "Save the active docked Surface as a new template" }));
		fireEvent.keyDown(screen.getByLabelText("New template title"), { key: "Escape" });

		expect(screen.queryByLabelText("New template title")).not.toBeInTheDocument();
		expect(onSaveCurrentAsTemplate).not.toHaveBeenCalled();
	});
});
