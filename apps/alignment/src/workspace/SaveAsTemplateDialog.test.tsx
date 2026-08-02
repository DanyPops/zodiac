/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveAsTemplateDialog } from "./SaveAsTemplateDialog.js";

afterEach(cleanup);

function renderDialog(open = true, defaultTitle = "Filesystem") {
	const onClose = vi.fn();
	const onSave = vi.fn();
	render(<SaveAsTemplateDialog open={open} defaultTitle={defaultTitle} onClose={onClose} onSave={onSave} />);
	return { onClose, onSave };
}

describe("SaveAsTemplateDialog", () => {
	it("pre-fills the title input with the Surface's current title", () => {
		renderDialog(true, "Filesystem");
		expect(screen.getByLabelText("Template title")).toHaveValue("Filesystem");
	});

	it("renders nothing interactive while closed", () => {
		renderDialog(false);
		expect(screen.queryByLabelText("Template title")).not.toBeInTheDocument();
	});

	it("submitting calls onSave with the (possibly edited) title", () => {
		const { onSave } = renderDialog(true, "Filesystem");
		fireEvent.change(screen.getByLabelText("Template title"), { target: { value: "My Filesystem" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onSave).toHaveBeenCalledWith("My Filesystem");
	});

	it("Save is disabled for a blank title", () => {
		renderDialog(true, "Filesystem");
		fireEvent.change(screen.getByLabelText("Template title"), { target: { value: "   " } });
		expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
	});

	it("Cancel calls onClose, not onSave", () => {
		const { onClose, onSave } = renderDialog(true);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledOnce();
		expect(onSave).not.toHaveBeenCalled();
	});
});
