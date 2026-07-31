/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getHotkeyManager } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { WindowCarousel } from "./WindowCarousel.js";

afterEach(() => {
	cleanup();
	getHotkeyManager().destroy();
});

function renderCarousel(windowCount: number, activeIndex: number, onSelect: (index: number) => void) {
	const registry = createCommandRegistry({
		commands: [
			{ id: "window.previous", title: "Previous Window", description: "d", execute: vi.fn() },
			{ id: "window.next", title: "Next Window", description: "d", execute: vi.fn() },
			{ id: "window.new", title: "New Window", description: "d", execute: vi.fn() },
		],
		bindings: [],
	});
	return render(
		<CommandProvider registry={registry} activeContexts={["global"]}>
			<WindowCarousel windowCount={windowCount} activeIndex={activeIndex} onSelect={onSelect} />
		</CommandProvider>,
	);
}

describe("WindowCarousel", () => {
	it("marks the active Window with aria-current", () => {
		renderCarousel(3, 1, vi.fn());
		expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "true");
		expect(screen.getByRole("button", { name: "0" })).not.toHaveAttribute("aria-current");
	});

	it("clicking a Window index selects it directly", () => {
		const onSelect = vi.fn();
		renderCarousel(3, 0, onSelect);
		fireEvent.click(screen.getByRole("button", { name: "2" }));
		expect(onSelect).toHaveBeenCalledWith(2);
	});

	it("wheel scrolling forward advances by one and wraps past the last Window", () => {
		const onSelect = vi.fn();
		renderCarousel(3, 2, onSelect);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: 100 });
		expect(onSelect).toHaveBeenCalledWith(0);
	});

	it("wheel scrolling backward retreats by one and wraps before the first Window", () => {
		const onSelect = vi.fn();
		renderCarousel(3, 0, onSelect);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: -100 });
		expect(onSelect).toHaveBeenCalledWith(2);
	});

	it("a dominant horizontal (trackpad) delta drives the same wrap-around logic", () => {
		const onSelect = vi.fn();
		renderCarousel(3, 2, onSelect);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaX: 100, deltaY: 1 });
		expect(onSelect).toHaveBeenCalledWith(0);
	});

	it("a zero delta does nothing", () => {
		const onSelect = vi.fn();
		renderCarousel(3, 0, onSelect);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: 0, deltaX: 0 });
		expect(onSelect).not.toHaveBeenCalled();
	});
});
