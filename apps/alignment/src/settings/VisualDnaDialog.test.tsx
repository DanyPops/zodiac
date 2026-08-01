/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import type { VisualDna } from "../platform/visual-dna.js";
import { VisualDnaDialog } from "./VisualDnaDialog.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderDialog(value: VisualDna = { vibe: 100, cornerSharpness: 50 }) {
	const registry = createCommandRegistry({ commands: [{ id: "dialog.close", title: "Close dialog", description: "Closes the open dialog.", execute: vi.fn() }], bindings: [] });
	const onVibeChange = vi.fn();
	const onCornerSharpnessChange = vi.fn();
	const onClose = vi.fn();
	render(
		<CommandProvider registry={registry} activeContexts={["dialog"]}>
			<VisualDnaDialog open onClose={onClose} value={value} onVibeChange={onVibeChange} onCornerSharpnessChange={onCornerSharpnessChange} />
		</CommandProvider>,
	);
	return { onVibeChange, onCornerSharpnessChange, onClose };
}

describe("VisualDnaDialog", () => {
	it("shows both sliders at their current value, labeled Cartoon/Comfy/Professional and Square/Circle", () => {
		renderDialog({ vibe: 40, cornerSharpness: 75 });

		const vibe = screen.getByLabelText("Vibe") as HTMLInputElement;
		expect(vibe.value).toBe("40");
		expect(screen.getByText("Cartoon")).toBeInTheDocument();
		expect(screen.getByText("Comfy")).toBeInTheDocument();
		expect(screen.getByText("Professional")).toBeInTheDocument();

		const corner = screen.getByLabelText("Corner Sharpness") as HTMLInputElement;
		expect(corner.value).toBe("75");
		expect(screen.getByText("Square")).toBeInTheDocument();
		expect(screen.getByText("Circle")).toBeInTheDocument();
	});

	it("moving the Vibe slider reports the new value without touching Corner Sharpness", () => {
		const { onVibeChange, onCornerSharpnessChange } = renderDialog();
		fireEvent.change(screen.getByLabelText("Vibe"), { target: { value: "20" } });
		expect(onVibeChange).toHaveBeenCalledWith(20);
		expect(onCornerSharpnessChange).not.toHaveBeenCalled();
	});

	it("moving the Corner Sharpness slider reports the new value", () => {
		const { onCornerSharpnessChange } = renderDialog();
		fireEvent.change(screen.getByLabelText("Corner Sharpness"), { target: { value: "90" } });
		expect(onCornerSharpnessChange).toHaveBeenCalledWith(90);
	});

	it("the preview swatch's own inline style tracks the current value directly, not a CSS custom property that could drift", () => {
		renderDialog({ vibe: 0, cornerSharpness: 0 });
		const preview = screen.getByTestId("visual-dna-preview");
		expect(preview.style.borderWidth).toBe("3px");
		expect(preview.style.borderRadius).toBe("0px");
	});

	it("closing calls onClose", () => {
		const { onClose } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Close Visual DNA" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
