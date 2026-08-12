/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog.js";
import { DEFAULT_WORKSPACE_GLYPH_ID } from "./workspace-catalog.js";

afterEach(cleanup);

function renderDialog(open = true) {
	const onClose = vi.fn();
	const onCreate = vi.fn();
	render(<CreateWorkspaceDialog open={open} onClose={onClose} onCreate={onCreate} />);
	return { onClose, onCreate };
}

describe("CreateWorkspaceDialog", () => {
	it("starts with a blank title and the default glyph selected", () => {
		renderDialog();
		expect(screen.getByLabelText("Workspace title")).toHaveValue("");
		expect(screen.getByRole("radio", { name: DEFAULT_WORKSPACE_GLYPH_ID })).toHaveAttribute("aria-checked", "true");
	});

	it("Create is disabled for a blank title", () => {
		renderDialog();
		expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
	});

	it("picking a glyph then submitting calls onCreate with the title and that glyph id", () => {
		const { onCreate } = renderDialog();
		fireEvent.change(screen.getByLabelText("Workspace title"), { target: { value: "Deploys" } });
		fireEvent.click(screen.getByRole("radio", { name: "rocket" }));
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(onCreate).toHaveBeenCalledWith("Deploys", "rocket");
	});

	it("Cancel calls onClose without creating anything", () => {
		const { onClose, onCreate } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClose).toHaveBeenCalledOnce();
		expect(onCreate).not.toHaveBeenCalled();
	});

	it("renders nothing interactive while closed", () => {
		renderDialog(false);
		expect(screen.queryByLabelText("Workspace title")).not.toBeInTheDocument();
	});
});
