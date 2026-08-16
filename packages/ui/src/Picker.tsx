import type { PickerItem } from "@zodiac/protocol";
import { Command } from "cmdk";
import type { ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * A generic, keyboard-navigable "search + pick one of several" list -- the
 * React analog of pi-tui's SelectList / Malevich's BorderedSelectPanel.
 * Owns no selection/filtering logic of its own, only presentation: `items`
 * is already the caller's own filtered set (the same "host provides the
 * list" discipline BorderedSelectPanel uses), and what selecting an item
 * *means* (execute a command, dock a template, open a file) is entirely
 * the caller's call via `onSelect`.
 *
 * Built on cmdk (`shouldFilter={false}`, since filtering stays the
 * caller's job) rather than hand-rolled highlight/keyboard-nav state --
 * real prior art doing exactly this shape (query input + filtered list +
 * arrow-key/Enter navigation + empty state), actively maintained, already
 * built on Radix (this package's own existing foundation). Adopting it
 * shrank this file rather than growing it.
 *
 * First real caller: apps/web/src/commands/CommandDialog.tsx.
 */
export interface PickerProps<T = unknown> {
	readonly items: readonly PickerItem<T>[];
	readonly query: string;
	readonly onQueryChange: (query: string) => void;
	readonly onSelect: (item: PickerItem<T>) => void;
	/** Labels both the query input (when shown) and the listbox itself. */
	readonly queryAriaLabel: string;
	readonly queryPlaceholder?: string;
	/** Shown in place of the list when `items` is empty. */
	readonly emptyMessage?: string;
	/** False hides the query input entirely -- e.g. CommandDialog's own "shortcuts" mode browses a fixed list with no filtering. */
	readonly showQueryInput?: boolean;
	/** Extra content trailing an item's label/description, e.g. a keyboard-shortcut `<kbd>`. */
	readonly renderTrailing?: (item: PickerItem<T>) => ReactNode;
	/** Overrides an item's own accessible name -- e.g. "Change shortcut for X" instead of the visible label "X". */
	readonly itemAriaLabel?: (item: PickerItem<T>) => string;
}

export function Picker<T = unknown>({ items, query, onQueryChange, onSelect, queryAriaLabel, queryPlaceholder, emptyMessage, showQueryInput = true, renderTrailing, itemAriaLabel }: PickerProps<T>): React.JSX.Element {
	return (
		<Command shouldFilter={false} label={queryAriaLabel} loop>
			{showQueryInput && (
				<div className="border-b border-gray-200 p-3 dark:border-gray-700">
					<Command.Input
						autoFocus
						value={query}
						onValueChange={onQueryChange}
						aria-label={queryAriaLabel}
						placeholder={queryPlaceholder}
						className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800 dark:focus:ring-accent-70"
					/>
				</div>
			)}
			<Command.List aria-label={queryAriaLabel} className="max-h-[55vh] overflow-auto p-2">
				{items.length === 0 && emptyMessage && <Command.Empty className="px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{emptyMessage}</Command.Empty>}
				{items.map((item) => (
					<Command.Item
						key={item.id}
						value={item.id}
						disabled={item.disabled}
						aria-label={itemAriaLabel ? itemAriaLabel(item) : item.label}
						onSelect={() => onSelect(item)}
						className={cn(
							"flex w-full items-center gap-4 rounded-lg px-3 py-2 text-left outline-none aria-selected:bg-gray-100 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent aria-disabled:opacity-45 dark:aria-selected:bg-gray-800 dark:hover:bg-gray-800",
						)}
					>
						<span className="min-w-0 flex-1">
							<span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
							{item.description && <span className="block truncate text-xs text-gray-600 dark:text-gray-300">{item.description}</span>}
						</span>
						{renderTrailing?.(item)}
					</Command.Item>
				))}
			</Command.List>
		</Command>
	);
}
