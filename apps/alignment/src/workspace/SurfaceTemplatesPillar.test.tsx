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
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<SurfaceTemplatesPillar entries={ENTRIES} onDockDefault={onDockDefault} {...props} />
		</CommandProvider>,
	);
	return { onDockDefault };
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

	it("carries no save-as-template affordance of its own -- that's reached from a docked Surface's own tab context menu instead", () => {
		renderPillar();
		expect(screen.queryByLabelText(/save.*template/i)).not.toBeInTheDocument();
	});
});
