/** @vitest-environment jsdom */
import * as Tooltip from "@radix-ui/react-tooltip";
import { cleanup, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { PillarCap } from "./PillarCap.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderCap(slot: "start" | "end") {
	const execute = vi.fn();
	const registry = createCommandRegistry({ commands: [{ id: "pillar.cap", title: "Pillar Cap", description: "d", execute }], bindings: [] });
	render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<PillarCap commandId="pillar.cap" label="Pillar Cap" slot={slot}>
				<span>glyph</span>
			</PillarCap>
		</CommandProvider>,
	);
	return { execute };
}

describe("PillarCap", () => {
	it("is a full pillar-width, fixed-height cell -- the same shape at every call site", () => {
		renderCap("start");
		const button = screen.getByRole("button", { name: "Pillar Cap" });
		expect(button).toHaveClass("h-12", "w-14");
	});

	it("renders its glyph directly, with no separate nested chip", () => {
		renderCap("start");
		expect(screen.getByText("glyph").parentElement).toBe(screen.getByRole("button", { name: "Pillar Cap" }));
	});

	it("dividers against the rest of the pillar on the side facing away from its own edge", () => {
		renderCap("start");
		expect(screen.getByRole("button", { name: "Pillar Cap" }).className).toMatch(/border-b/);
		cleanup();
		renderCap("end");
		expect(screen.getByRole("button", { name: "Pillar Cap" }).className).toMatch(/border-t/);
	});

	// Regression: PillarTooltip's Tooltip.Trigger asChild needs to clone a ref
	// and hover handlers onto PillarCap's real button -- a plain component
	// silently drops both. Verified live too: three real tooltips were broken.
	it("forwards a ref and extra props to its own real button, the way Tooltip.Trigger asChild requires", () => {
		const ref = createRef<HTMLButtonElement>();
		const onPointerEnter = vi.fn();
		const execute = vi.fn();
		const registry = createCommandRegistry({ commands: [{ id: "pillar.cap", title: "Pillar Cap", description: "d", execute }], bindings: [] });
		render(
			<CommandProvider registry={registry} activeContexts={["global"]}>
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<PillarCap commandId="pillar.cap" label="Pillar Cap" slot="start" ref={ref} onPointerEnter={onPointerEnter}>
								<span>glyph</span>
							</PillarCap>
						</Tooltip.Trigger>
					</Tooltip.Root>
				</Tooltip.Provider>
			</CommandProvider>,
		);
		const button = screen.getByRole("button", { name: "Pillar Cap" });
		expect(ref.current).toBe(button);
		// React synthesizes onPointerEnter from bubbling "pointerover", not "pointerenter".
		button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
		expect(onPointerEnter).toHaveBeenCalled();
	});
});
