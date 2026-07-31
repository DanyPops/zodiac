import * as Dialog from "@radix-ui/react-dialog";
import { formatForDisplay, useHotkeyRecorder, type Hotkey } from "@tanstack/react-hotkeys";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CommandButton, useCommandEnvironment } from "./react.js";
import type { KeybindingDefinition } from "./registry.js";
import type { DialogMode } from "./useCommandContextStack.js";

function bindingLabel(isEditingThisCommand: boolean, isRecording: boolean, binding: KeybindingDefinition | undefined): string {
	if (isEditingThisCommand && isRecording) return "Press keys…";
	if (binding) return formatForDisplay(binding.keys);
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
			.filter((command) => !normalized || `${command.title} ${command.description}`.toLowerCase().includes(normalized));
	}, [query, registry]);

	return (
		<Dialog.Root open={isOpen} onOpenChange={(open) => !open && onModeChange(null)}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-40 bg-gray-950/45 backdrop-blur-[1px] data-[state=open]:animate-in" />
				<Dialog.Content
					aria-label={title}
					className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900"
				>
					<div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<Search aria-hidden="true" size={17} className="text-gray-500" />
						<Dialog.Title className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</Dialog.Title>
						<Dialog.Close asChild>
							<CommandButton
								commandId="dialog.close"
								label={`Close ${title.toLowerCase()}`}
								className="ml-auto rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-gray-800"
							>
								<X aria-hidden="true" size={16} />
							</CommandButton>
						</Dialog.Close>
					</div>
					<Dialog.Description className="sr-only">
						{mode === "palette" ? "Search and execute Alignment commands." : "Inspect the active keyboard bindings for Alignment commands."}
					</Dialog.Description>
					{mode === "palette" && (
						<div className="border-b border-gray-200 p-3 dark:border-gray-700">
							<input
								autoFocus
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								aria-label="Filter commands"
								placeholder="Type a command…"
								className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-20 dark:border-gray-600 dark:bg-gray-800 dark:focus:ring-accent-70"
							/>
						</div>
					)}
					{bindingError && <p role="alert" className="mx-3 mt-3 rounded-md bg-danger-10 px-3 py-2 text-xs text-danger-80">{bindingError}</p>}
					<div className="max-h-[55vh] overflow-auto p-2">
						{commands.map((command) => {
							const binding = registry.bindingFor(command.id);
							return (
								<button
									key={command.id}
									type="button"
									aria-label={mode === "shortcuts" ? `Change shortcut for ${command.title}` : command.title}
									disabled={command.enabled?.() === false && mode === "palette"}
									onClick={() => {
										if (mode === "shortcuts") {
											setBindingError(undefined);
											setEditingCommandId(command.id);
											recorder.startRecording();
										} else {
											registry.execute(command.id);
											onModeChange(null);
										}
									}}
									className="flex w-full items-center gap-4 rounded-lg px-3 py-2 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-45 dark:hover:bg-gray-800"
								>
									<span className="min-w-0 flex-1">
										<span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{command.title}</span>
										<span className="block truncate text-xs text-gray-600 dark:text-gray-300">{command.description}</span>
									</span>
									<kbd className="shrink-0 rounded border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">
									{bindingLabel(editingCommandId === command.id, recorder.isRecording, binding)}
									</kbd>
								</button>
							);
						})}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
