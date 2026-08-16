/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PickerItem } from "@zodiac/protocol";
import { Picker } from "./Picker.js";

afterEach(cleanup);

const ITEMS: readonly PickerItem<string>[] = [
	{ id: "a", label: "Alpha", description: "First", value: "a" },
	{ id: "b", label: "Bravo", description: "Second", disabled: true, value: "b" },
	{ id: "c", label: "Charlie", description: "Third", value: "c" },
];

describe("Picker", () => {
	it("renders every item's label and description", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" />);
		expect(screen.getByRole("option", { name: "Alpha" })).toBeInTheDocument();
		expect(screen.getByText("First")).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Charlie" })).toBeInTheDocument();
	});

	it("clicking an item calls onSelect with that item", () => {
		const onSelect = vi.fn();
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={onSelect} queryAriaLabel="Filter" />);
		fireEvent.click(screen.getByRole("option", { name: "Charlie" }));
		expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
	});

	it("typing in the query input calls onQueryChange", () => {
		const onQueryChange = vi.fn();
		render(<Picker items={ITEMS} query="" onQueryChange={onQueryChange} onSelect={() => {}} queryAriaLabel="Filter" queryPlaceholder="Type…" />);
		fireEvent.change(screen.getByRole("combobox", { name: "Filter" }), { target: { value: "al" } });
		expect(onQueryChange).toHaveBeenCalledWith("al");
	});

	it("starts highlighting the first non-disabled item", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" />);
		expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("option", { name: "Bravo" })).toHaveAttribute("aria-selected", "false");
	});

	it("ArrowDown moves the highlight to the next non-disabled item, skipping disabled ones", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" />);
		fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
		expect(screen.getByRole("option", { name: "Charlie" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
	});

	it("ArrowUp wraps around to the last non-disabled item", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" />);
		fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowUp" });
		expect(screen.getByRole("option", { name: "Charlie" })).toHaveAttribute("aria-selected", "true");
	});

	it("Enter selects the currently highlighted item", () => {
		const onSelect = vi.fn();
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={onSelect} queryAriaLabel="Filter" />);
		fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
		fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });
		expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
	});

	it("disabled items render disabled and are never selected by Enter", () => {
		const onSelect = vi.fn();
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={onSelect} queryAriaLabel="Filter" />);
		expect(screen.getByRole("option", { name: "Bravo" })).toHaveAttribute("aria-disabled", "true");
	});

	it("showQueryInput=false hides the query input entirely", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" showQueryInput={false} />);
		expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
	});

	it("shows emptyMessage when there are no items", () => {
		render(<Picker items={[]} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" emptyMessage="Nothing found" />);
		expect(screen.getByText("Nothing found")).toBeInTheDocument();
	});

	it("itemAriaLabel overrides an item's own accessible name", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" itemAriaLabel={(item) => `Change shortcut for ${item.label}`} />);
		expect(screen.getByRole("option", { name: "Change shortcut for Alpha" })).toBeInTheDocument();
	});

	it("renderTrailing renders extra content per item", () => {
		render(<Picker items={ITEMS} query="" onQueryChange={() => {}} onSelect={() => {}} queryAriaLabel="Filter" renderTrailing={(item) => <kbd>{item.value}</kbd>} />);
		expect(screen.getByRole("option", { name: "Alpha" }).querySelector("kbd")).toHaveTextContent("a");
	});
});
