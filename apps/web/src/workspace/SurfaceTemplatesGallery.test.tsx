/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandProvider } from "../commands/react.js";
import { createCommandRegistry } from "../commands/registry.js";
import { GALLERY_CATEGORIES } from "./gallery-categories.js";
import { SurfaceTemplatesGallery } from "./SurfaceTemplatesGallery.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

function renderGallery(open: boolean, onClose = vi.fn()) {
	const registry = createCommandRegistry({ commands: [{ id: "dialog.close", title: "Close dialog", description: "", execute: vi.fn() }], bindings: [] });
	return render(
		<CommandProvider registry={registry} activeContexts={["dialog"]}>
			<SurfaceTemplatesGallery open={open} onClose={onClose} />
		</CommandProvider>,
	);
}

describe("SurfaceTemplatesGallery", () => {
	it("renders a card for every gallery category", () => {
		renderGallery(true);
		for (const category of GALLERY_CATEGORIES) expect(screen.getByText(category.title)).toBeInTheDocument();
	});

	it("renders nothing interactive while closed", () => {
		renderGallery(false);
		expect(screen.queryByText(GALLERY_CATEGORIES[0]!.title)).not.toBeInTheDocument();
	});

	// Radix's Dialog.Portal renders into document.body, outside RTL's own
	// `container` -- query the whole document for these, not `container`.
	it("each card starts showing its icon cluster, not the preview", () => {
		renderGallery(true);
		const iconLayer = document.body.querySelector('[class*="grid-cols-2"][class*="opacity-100"]');
		expect(iconLayer).not.toBeNull();
	});

	it("automatically cross-fades to the preview after the interval, with no interaction needed", () => {
		renderGallery(true);
		act(() => vi.advanceTimersByTime(3000));
		const previewLayers = document.body.querySelectorAll('[class*="opacity-100"]');
		// At least one card's preview layer (not the icon-cluster layer) is now visible.
		expect(Array.from(previewLayers).some((el) => !el.className.includes("grid-cols-2"))).toBe(true);
	});

	it("keeps looping back and forth, not stopping after one cross-fade", () => {
		renderGallery(true);
		act(() => vi.advanceTimersByTime(3000)); // -> preview
		act(() => vi.advanceTimersByTime(3000)); // -> icons again
		const iconLayer = document.body.querySelector('[class*="grid-cols-2"][class*="opacity-100"]');
		expect(iconLayer).not.toBeNull();
	});
});
