/** @vitest-environment jsdom */
import * as Dialog from "@radix-ui/react-dialog";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createCommandRegistry } from "./registry.js";
import { CommandProvider } from "./react.js";
import { DialogCloseButton } from "./DialogCloseButton.js";

describe("DialogCloseButton", () => {
	it("labels itself with the caller's own text and closes the surrounding Dialog", () => {
		const registry = createCommandRegistry({ commands: [{ id: "dialog.close", title: "Close dialog", description: "", execute: vi.fn() }], bindings: [] });
		render(
			<CommandProvider registry={registry} activeContexts={["dialog"]}>
				<Dialog.Root open>
					<Dialog.Portal>
						<Dialog.Content aria-label="Test dialog">
							<Dialog.Title>Test</Dialog.Title>
							<DialogCloseButton label="Close Test dialog" />
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			</CommandProvider>,
		);
		expect(screen.getByRole("button", { name: "Close Test dialog" })).toBeInTheDocument();
	});
});
