import type { PickerItem } from "@zodiac/protocol";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn.js";

/**
 * A generic, keyboard-navigable "search + pick one of several" list -- the
 * React analog of pi-tui's SelectList / Malevich's BorderedSelectPanel.
 * Owns no selection/filtering logic of its own, only the query input and
 * highlighted-row bookkeeping: `items` is already the caller's own
 * filtered set (the same "host provides the list" discipline
 * BorderedSelectPanel uses), and what selecting an item *means* (execute a
 * command, dock a template, open a file) is entirely the caller's call via
 * `onSelect`.
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
	const selectableIndexes = items.reduce<number[]>((indexes, item, index) => {
		if (!item.disabled) indexes.push(index);
		return indexes;
	}, []);
	const [highlighted, setHighlighted] = useState(selectableIndexes[0] ?? -1);

	useEffect(() => {
		// The visible list just changed shape (e.g. the query re-filtered it) --
		// an index held over from the previous list could now point at a
		// different item, a disabled one, or nothing at all.
		setHighlighted(selectableIndexes[0] ?? -1);
		// selectableIndexes is a fresh array every render; only `items` itself (the list's own identity/content) should trigger this reset.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items]);

	function moveHighlight(direction: 1 | -1): void {
		if (selectableIndexes.length === 0) return;
		const currentPosition = selectableIndexes.indexOf(highlighted);
		const nextPosition = currentPosition === -1 ? 0 : (currentPosition + direction + selectableIndexes.length) % selectableIndexes.length;
		setHighlighted(selectableIndexes[nextPosition]!);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			moveHighlight(1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			moveHighlight(-1);
		} else if (event.key === "Enter") {
			const item = items[highlighted];
			if (item && !item.disabled) {
				event.preventDefault();
				onSelect(item);
			}
		}
	}

	return (
		<div onKeyDown={handleKeyDown}>
			{showQueryInput && (
				<div className="border-b border-gray-200 p-3 dark:border-gray-700">
					<input
						autoFocus
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
						aria-label={queryAriaLabel}
						placeholder={queryPlaceholder}
						className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800 dark:focus:ring-accent-70"
					/>
				</div>
			)}
			<div role="listbox" aria-label={queryAriaLabel} className="max-h-[55vh] overflow-auto p-2">
				{items.length === 0 && emptyMessage && <p className="px-3 py-4 text-sm text-gray-600 dark:text-gray-300">{emptyMessage}</p>}
				{items.map((item, index) => (
					<button
						key={item.id}
						type="button"
						role="option"
						aria-selected={index === highlighted}
						aria-label={itemAriaLabel ? itemAriaLabel(item) : item.label}
						disabled={item.disabled}
						onClick={() => onSelect(item)}
						onMouseEnter={() => !item.disabled && setHighlighted(index)}
						className={cn(
							"flex w-full items-center gap-4 rounded-lg px-3 py-2 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45 dark:hover:bg-gray-800",
							index === highlighted && "bg-gray-100 dark:bg-gray-800",
						)}
					>
						<span className="min-w-0 flex-1">
							<span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
							{item.description && <span className="block truncate text-xs text-gray-600 dark:text-gray-300">{item.description}</span>}
						</span>
						{renderTrailing?.(item)}
					</button>
				))}
			</div>
		</div>
	);
}
