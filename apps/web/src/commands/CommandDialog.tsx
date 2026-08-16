import * as Dialog from "@radix-ui/react-dialog";
import { formatForDisplay, useHotkeyRecorder, type Hotkey } from "@tanstack/react-hotkeys";
import { DialogChrome, Picker } from "@zodiac/ui";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DialogCloseButton } from "./DialogCloseButton.js";
import { useCommandEnvironment } from "./react.js";
import type { CommandDefinition } from "./registry.js";
import type { DialogMode } from "./useCommandContextStack.js";

function bindingLabel(isEditingThisCommand: boolean, isRecording: boolean, keys: string | undefined): string {
	if (isEditingThisCommand && isRecording) return "Press keys…";
	if (keys) return formatForDisplay(keys);
	return "Unbound";
}

export function CommandDialog({
	mode,
	onModeChange,
	onRebind,
}: {
	/** Only "palette" and "shortcuts" open this dialog; any other DialogMode (including "templates", owned by TemplatesDialog) renders it closed. */
	readonly mode: DialogMode;
	readonly onModeChange: (mode: DialogMode) => void;
	readonly onRebind: (commandId: string, hotkey: Hotkey) => string | undefined;
}): React.JSX.Element {
	const isOpen = mode === "palette" || mode === "shortcuts";
	const { registry } = useCommandEnvironment();
	const [query, setQuery] = useState("");
	const [editingCommandId, setEditingCommandId] = useState<string>();
	const [bindingError, setBindingError] = useState<string>();
	const recorder = useHotkeyRecorder({
		ignoreInputs: false,
		onRecord(hotkey) {
			if (!editingCommandId) return;
			const error = onRebind(editingCommandId, hotkey);
			setBindingError(error);
			if (!error) setEditingCommandId(undefined);
		},
		onCancel: () => setEditingCommandId(undefined),
	});

	useEffect(() => {
		if (mode !== "shortcuts") {
			recorder.cancelRecording();
			setEditingCommandId(undefined);
			setBindingError(undefined);
		}
		// recorder is a fresh object every render (useHotkeyRecorder doesn't
		// memoize its return value); including it here would re-run this reset
		// on every render instead of only when the dialog's mode actually
		// changes, which is the one thing this effect is meant to react to.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode]);
	const title = mode === "palette" ? "Command palette" : "Keyboard shortcuts";
	const commands = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return registry
			.commands()
			.filter((command) => !normalized || `${command.title} ${command.description}`.toLowerCase().includes(normalized))
			.map((command) => ({
				id: command.id,
				label: command.title,
				description: command.description,
				disabled: mode === "palette" && command.enabled?.() === false,
				value: command,
			}));
	}, [query, registry, mode]);

	return (
		<DialogChrome variant="dialog" open={isOpen} onOpenChange={(open) => !open && onModeChange(null)} width={640} topOffsetVh={14} ariaLabel={title}>
			<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<Search aria-hidden="true" size={17} className="text-gray-500" />
				<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</Dialog.Title>
				<DialogCloseButton label={`Close ${title.toLowerCase()}`} />
			</div>
			<Dialog.Description className="sr-only">
				{mode === "palette" ? "Search and execute Zodiac commands." : "Inspect the active keyboard bindings for Zodiac commands."}
			</Dialog.Description>
			{bindingError && <p role="alert" className="mx-3 mt-3 rounded-md bg-danger-10 px-3 py-2 text-xs text-danger-80">{bindingError}</p>}
			<Picker<CommandDefinition>
				items={commands}
				query={query}
				onQueryChange={setQuery}
				showQueryInput={mode === "palette"}
				queryAriaLabel="Filter commands"
				queryPlaceholder="Type a command…"
				itemAriaLabel={(item) => (mode === "shortcuts" ? `Change shortcut for ${item.label}` : item.label)}
				renderTrailing={(item) => (
					<kbd className="shrink-0 rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
						{bindingLabel(editingCommandId === item.id, recorder.isRecording, registry.bindingFor(item.id)?.keys)}
					</kbd>
				)}
				onSelect={(item) => {
					if (mode === "shortcuts") {
						setBindingError(undefined);
						setEditingCommandId(item.id);
						recorder.startRecording();
					} else {
						registry.execute(item.id);
						onModeChange(null);
					}
				}}
			/>
		</DialogChrome>
	);
}
