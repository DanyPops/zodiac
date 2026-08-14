/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import type { ChatPlacement } from "../platform/chat-placement.js";
import type { ShapeSettings } from "../platform/shape-settings.js";
import { SettingsDialog } from "./SettingsDialog.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderDialog(value: ShapeSettings = { strokeWidth: 100, cornerRadius: 50 }, chatPlacement: ChatPlacement = "right") {
	const registry = createCommandRegistry({
		commands: [
			{ id: "dialog.close", title: "Close dialog", description: "Closes the open dialog.", execute: vi.fn() },
			{ id: "palette.open", title: "Open command palette", description: "", execute: vi.fn() },
			{ id: "shortcuts.open", title: "Open keyboard shortcuts", description: "", execute: vi.fn() },
			{ id: "theme.cycle", title: "Cycle color theme", description: "", execute: vi.fn() },
		],
		bindings: [],
	});
	const onStrokeWidthChange = vi.fn();
	const onCornerRadiusChange = vi.fn();
	const onChatPlacementChange = vi.fn();
	const onClose = vi.fn();
	render(
		<CommandProvider registry={registry} activeContexts={["dialog"]}>
			<SettingsDialog open onClose={onClose} value={value} onStrokeWidthChange={onStrokeWidthChange} onCornerRadiusChange={onCornerRadiusChange} chatPlacement={chatPlacement} onChatPlacementChange={onChatPlacementChange} />
		</CommandProvider>,
	);
	return { onStrokeWidthChange, onCornerRadiusChange, onChatPlacementChange, onClose };
}

describe("SettingsDialog", () => {
	it("shows both sliders at their current value, labeled Cartoon/Comfy/Professional and Square/Circle", () => {
		renderDialog({ strokeWidth: 40, cornerRadius: 75 });

		const strokeWidth = screen.getByLabelText("Stroke Width") as HTMLInputElement;
		expect(strokeWidth.value).toBe("40");
		expect(screen.getByText("Cartoon")).toBeInTheDocument();
		expect(screen.getByText("Comfy")).toBeInTheDocument();
		expect(screen.getByText("Professional")).toBeInTheDocument();

		const corner = screen.getByLabelText("Corner Radius") as HTMLInputElement;
		expect(corner.value).toBe("75");
		expect(screen.getByText("Square")).toBeInTheDocument();
		expect(screen.getByText("Circle")).toBeInTheDocument();
	});

	it("moving the Stroke Width slider reports the new value without touching Corner Radius", () => {
		const { onStrokeWidthChange, onCornerRadiusChange } = renderDialog();
		fireEvent.change(screen.getByLabelText("Stroke Width"), { target: { value: "20" } });
		expect(onStrokeWidthChange).toHaveBeenCalledWith(20);
		expect(onCornerRadiusChange).not.toHaveBeenCalled();
	});

	it("moving the Corner Radius slider reports the new value", () => {
		const { onCornerRadiusChange } = renderDialog();
		fireEvent.change(screen.getByLabelText("Corner Radius"), { target: { value: "90" } });
		expect(onCornerRadiusChange).toHaveBeenCalledWith(90);
	});

	it("the preview swatch's own inline style tracks the current value directly, not a CSS custom property that could drift", () => {
		renderDialog({ strokeWidth: 0, cornerRadius: 0 });
		const preview = screen.getByTestId("shape-preview");
		expect(preview.style.borderWidth).toBe("3px");
		expect(preview.style.borderRadius).toBe("0px");
	});

	it("closing calls onClose", () => {
		const { onClose } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Close Settings" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("is titled Settings, the umbrella dialog, with the folded shell actions alongside Appearance", () => {
		renderDialog();
		expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Command Palette" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cycle Theme" })).toBeInTheDocument();
	});

	describe("Chat placement", () => {
		it("shows all four edges, with the current one pressed", () => {
			renderDialog(undefined, "left");
			for (const label of ["Top", "Bottom", "Left", "Right"]) expect(screen.getByRole("button", { name: `Dock Chat to the ${label}` })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "Dock Chat to the Left", pressed: true })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: "Dock Chat to the Right", pressed: false })).toBeInTheDocument();
		});

		it("clicking an edge reports the new placement", () => {
			const { onChatPlacementChange } = renderDialog(undefined, "right");
			fireEvent.click(screen.getByRole("button", { name: "Dock Chat to the Bottom" }));
			expect(onChatPlacementChange).toHaveBeenCalledWith("bottom");
		});
	});
});
