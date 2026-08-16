/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DialogChrome } from "./DialogChrome.js";

afterEach(cleanup);

describe("DialogChrome", () => {
	it("dialog variant renders its content and aria-label when open", () => {
		render(
			<DialogChrome variant="dialog" open onOpenChange={() => {}} width={420} topOffsetVh={14} ariaLabel="Settings">
				<Dialog.Title>Settings</Dialog.Title>
				<p>Body</p>
			</DialogChrome>,
		);
		expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
		expect(screen.getByText("Body")).toBeInTheDocument();
	});

	it("dialog variant renders nothing when closed", () => {
		render(
			<DialogChrome variant="dialog" open={false} onOpenChange={() => {}} width={420} topOffsetVh={14} ariaLabel="Settings">
				<p>Body</p>
			</DialogChrome>,
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("alert variant renders as an alertdialog, named by its own Title child", () => {
		render(
			<DialogChrome variant="alert" open onOpenChange={() => {}} width={360} topOffsetVh={20}>
				<AlertDialog.Title>Close Workspace?</AlertDialog.Title>
			</DialogChrome>,
		);
		expect(screen.getByRole("alertdialog", { name: "Close Workspace?" })).toBeInTheDocument();
	});

	it("calls onOpenChange(false) when Escape is pressed", () => {
		const onOpenChange = vi.fn();
		render(
			<DialogChrome variant="dialog" open onOpenChange={onOpenChange} width={420} topOffsetVh={14} ariaLabel="Settings">
				<Dialog.Title>Settings</Dialog.Title>
			</DialogChrome>,
		);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
