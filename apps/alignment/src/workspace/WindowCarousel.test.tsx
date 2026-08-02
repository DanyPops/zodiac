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

function renderCarousel(windowCount: number, activeIndex: number, onSelect: (index: number) => void, onScroll: (direction: 1 | -1) => void = vi.fn(), activeWindowTitle = "Window 1", onRenameActiveWindow: (title: string) => void = vi.fn()) {
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
			<WindowCarousel windowCount={windowCount} activeIndex={activeIndex} onSelect={onSelect} onScroll={onScroll} activeWindowTitle={activeWindowTitle} onRenameActiveWindow={onRenameActiveWindow} />
		</CommandProvider>,
	);
}

describe("WindowCarousel", () => {
	it("marks the active Window with aria-current", () => {
		renderCarousel(3, 1, vi.fn());
		expect(screen.getByRole("button", { name: "1" })).toHaveAttribute("aria-current", "true");
		expect(screen.getByRole("button", { name: "0" })).not.toHaveAttribute("aria-current");
	});

	it("breathes continuously (the calm wisp-breathe animation, not Tailwind's default pulse) on the active Window, and only on hover/keyboard-focus for every other one", () => {
		renderCarousel(3, 1, vi.fn());
		const active = screen.getByRole("button", { name: "1" });
		expect(active).toHaveClass("animate-wisp-breathe");
		const inactive = screen.getByRole("button", { name: "0" });
		expect(inactive.className).not.toMatch(/(?<!:)animate-wisp-breathe/);
		expect(inactive).toHaveClass("hover:animate-wisp-breathe");
		expect(inactive).toHaveClass("focus-visible:animate-wisp-breathe");
		expect(inactive).toHaveClass("motion-reduce:animate-none");
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

	it("a burst of small wheel events (a real trackpad gesture) accumulates distance instead of stepping on every event", () => {
		const onScroll = vi.fn();
		renderCarousel(7, 3, vi.fn(), onScroll);
		const carousel = screen.getByLabelText("Window Carousel");
		// 30 events of 4px each = 120px total -- well under one step per event,
		// but still enough distance to cross the 50px threshold a few times.
		for (let i = 0; i < 30; i++) fireEvent.wheel(carousel, { deltaY: 4 });
		expect(onScroll.mock.calls.length).toBeLessThan(5);
		expect(onScroll.mock.calls.length).toBeGreaterThan(0);
		for (const call of onScroll.mock.calls) expect(call).toEqual([1]);
	});

	it("a single large delta (a real mouse wheel notch) still advances exactly one Window, not several", () => {
		const onScroll = vi.fn();
		renderCarousel(7, 3, vi.fn(), onScroll);
		fireEvent.wheel(screen.getByLabelText("Window Carousel"), { deltaY: 250 });
		expect(onScroll).toHaveBeenCalledTimes(1);
		expect(onScroll).toHaveBeenCalledWith(1);
	});

	it("the Windows viewport is a fixed content-hugging width, not a flex-1 fill", () => {
		renderCarousel(3, 0, vi.fn());
		const viewport = screen.getByLabelText("Windows").parentElement as HTMLElement;
		expect(viewport.className).not.toContain("flex-1");
		expect(viewport.style.width).not.toBe("");
	});

	describe("Win Name row", () => {
		it("shows the active Window's title as a rename button", () => {
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging");
			expect(screen.getByRole("button", { name: "Rename Debugging" })).toHaveTextContent("Debugging");
		});

		it("clicking it opens an inline text input pre-filled with the current title", () => {
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging");
			fireEvent.click(screen.getByRole("button", { name: "Rename Debugging" }));
			expect(screen.getByLabelText("Rename Window")).toHaveValue("Debugging");
		});

		it("pressing Enter commits the new title", () => {
			const onRename = vi.fn();
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging", onRename);
			fireEvent.click(screen.getByRole("button", { name: "Rename Debugging" }));
			fireEvent.change(screen.getByLabelText("Rename Window"), { target: { value: "Deploy" } });
			fireEvent.keyDown(screen.getByLabelText("Rename Window"), { key: "Enter" });
			expect(onRename).toHaveBeenCalledWith("Deploy");
		});

		it("pressing Escape discards the edit without committing", () => {
			const onRename = vi.fn();
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging", onRename);
			fireEvent.click(screen.getByRole("button", { name: "Rename Debugging" }));
			fireEvent.change(screen.getByLabelText("Rename Window"), { target: { value: "Deploy" } });
			fireEvent.keyDown(screen.getByLabelText("Rename Window"), { key: "Escape" });
			expect(onRename).not.toHaveBeenCalled();
			expect(screen.getByRole("button", { name: "Rename Debugging" })).toBeInTheDocument();
		});

		it("blurring commits, same as Enter", () => {
			const onRename = vi.fn();
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging", onRename);
			fireEvent.click(screen.getByRole("button", { name: "Rename Debugging" }));
			fireEvent.change(screen.getByLabelText("Rename Window"), { target: { value: "Deploy" } });
			fireEvent.blur(screen.getByLabelText("Rename Window"));
			expect(onRename).toHaveBeenCalledWith("Deploy");
		});

		it("committing an unchanged or blank title does not call onRename", () => {
			const onRename = vi.fn();
			renderCarousel(1, 0, vi.fn(), vi.fn(), "Debugging", onRename);
			fireEvent.click(screen.getByRole("button", { name: "Rename Debugging" }));
			fireEvent.keyDown(screen.getByLabelText("Rename Window"), { key: "Enter" });
			expect(onRename).not.toHaveBeenCalled();
		});
	});
});
