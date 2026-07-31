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

function renderCarousel(windowCount: number, activeIndex: number, onSelect: (index: number) => void, onScroll: (direction: 1 | -1) => void = vi.fn()) {
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
			<WindowCarousel windowCount={windowCount} activeIndex={activeIndex} onSelect={onSelect} onScroll={onScroll} />
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

	it("wheel scrolling forward calls onScroll(1), not onSelect -- the wheel creates/moves via scrollWindow, it doesn't wrap by index", () => {
		const onSelect = vi.fn();
		const onScroll = vi.fn();
		renderCarousel(3, 2, onSelect, onScroll);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: 100 });
		expect(onScroll).toHaveBeenCalledWith(1);
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("wheel scrolling backward calls onScroll(-1)", () => {
		const onScroll = vi.fn();
		renderCarousel(3, 0, vi.fn(), onScroll);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: -100 });
		expect(onScroll).toHaveBeenCalledWith(-1);
	});

	it("a dominant horizontal (trackpad) delta drives the same onScroll direction logic", () => {
		const onScroll = vi.fn();
		renderCarousel(3, 2, vi.fn(), onScroll);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaX: 100, deltaY: 1 });
		expect(onScroll).toHaveBeenCalledWith(1);
	});

	it("a zero delta does nothing", () => {
		const onScroll = vi.fn();
		renderCarousel(3, 0, vi.fn(), onScroll);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: 0, deltaX: 0 });
		expect(onScroll).not.toHaveBeenCalled();
	});
});
