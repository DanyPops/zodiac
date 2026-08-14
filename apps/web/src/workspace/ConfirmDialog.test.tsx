/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.js";

afterEach(cleanup);

function renderDialog(open = true) {
	const onConfirm = vi.fn();
	const onCancel = vi.fn();
	render(<ConfirmDialog open={open} title="Close Bug Triage?" description="Every Window and docked Surface in it is discarded. This can't be undone." confirmLabel="Close Workspace" onConfirm={onConfirm} onCancel={onCancel} />);
	return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
	it("renders the given title, description, and confirm label", () => {
		renderDialog();
		expect(screen.getByRole("alertdialog", { name: "Close Bug Triage?" })).toBeInTheDocument();
		expect(screen.getByText("Every Window and docked Surface in it is discarded. This can't be undone.")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Close Workspace" })).toBeInTheDocument();
	});

	it("clicking the confirm button calls onConfirm, not onCancel", () => {
		const { onConfirm, onCancel } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Close Workspace" }));
		expect(onConfirm).toHaveBeenCalledOnce();
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("clicking Cancel calls onCancel, not onConfirm", () => {
		const { onConfirm, onCancel } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it("renders nothing interactive while closed", () => {
		renderDialog(false);
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
	});
});
