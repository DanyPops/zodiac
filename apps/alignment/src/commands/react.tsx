import * as Tooltip from "@radix-ui/react-tooltip";
import { formatForDisplay, parseHotkey, useHotkeys, type Hotkey } from "@tanstack/react-hotkeys";
import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { CommandContext, CommandRegistry } from "./registry.js";

interface CommandEnvironment {
	registry: CommandRegistry;
	activeContexts: readonly CommandContext[];
}

const CommandEnvironmentContext = createContext<CommandEnvironment | undefined>(undefined);

export function CommandProvider({
	registry,
	activeContexts,
	children,
}: CommandEnvironment & { children: ReactNode }): React.JSX.Element {
	const bindings = registry.bindings();
	useHotkeys(
		bindings.map((binding) => ({
			hotkey: binding.keys as Hotkey,
			callback: () => registry.execute(binding.commandId),
			options: {
				enabled: activeContexts.includes(binding.context),
				ignoreInputs: shouldIgnoreInputs(binding.keys, binding.context),
				meta: {
					name: registry.commands().find((command) => command.id === binding.commandId)?.title,
					description: registry.commands().find((command) => command.id === binding.commandId)?.description,
				},
			},
		})),
		{ conflictBehavior: "error" },
	);

	return (
		<CommandEnvironmentContext.Provider value={{ registry, activeContexts }}>
			<Tooltip.Provider delayDuration={250}>{children}</Tooltip.Provider>
		</CommandEnvironmentContext.Provider>
	);
}

export function useCommandEnvironment(): CommandEnvironment {
	const value = useContext(CommandEnvironmentContext);
	if (!value) throw new Error("Command controls require CommandProvider");
	return value;
}

export function useCommandShortcut(commandId: string): string {
	const { registry, activeContexts } = useCommandEnvironment();
	const binding = registry.bindingFor(commandId, activeContexts);
	return binding ? formatForDisplay(binding.keys) : "Unbound";
}

interface CommandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	commandId: string;
	commandArgs?: unknown[];
	label: string;
	tooltip?: boolean;
	tooltipLayout?: "inline" | "stacked";
	tooltipSide?: "top" | "right" | "bottom" | "left";
}

export const CommandButton = forwardRef<HTMLButtonElement, CommandButtonProps>(function CommandButton(
	{ commandId, commandArgs = [], label, children, className = "", tooltip = true, tooltipLayout = "inline", tooltipSide = "top", onClick, ...props },
	ref,
): React.JSX.Element {
	const { registry, activeContexts } = useCommandEnvironment();
	const binding = registry.bindingFor(commandId, activeContexts);
	const shortcut = binding ? formatForDisplay(binding.keys) : "Unbound";
	const ariaShortcut = binding ? toAriaKeyShortcut(binding.keys) : undefined;

	// Composed, not overwritten by a later `{...props}` spread: wrapping this
	// button in Tooltip.Trigger's `asChild` (see PillarTooltip.tsx) clones an
	// onClick onto it at runtime (Radix's own tooltip-close behavior) that TS
	// can't see coming, since Slot cloning bypasses prop types entirely. A
	// plain `onClick={...} {...props}` ordering let that runtime-injected
	// handler silently replace command execution -- a real, live bug this
	// composition fixes, not just this one call site's workaround.
	const button = (
		<button
			ref={ref}
			type="button"
			aria-label={label}
			aria-keyshortcuts={ariaShortcut}
			className={className}
			onClick={(event) => {
				onClick?.(event);
				registry.execute(commandId, ...commandArgs);
			}}
			{...props}
		>
			{children}
		</button>
	);

	if (!tooltip) return button;
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					side={tooltipSide}
					sideOffset={7}
					className={`z-50 flex rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-xs text-white shadow-lg ${tooltipLayout === "stacked" ? "flex-col items-start gap-0.5" : "items-center gap-3"}`}
				>
					<span>{label}</span>
					<kbd className={tooltipLayout === "stacked" ? "font-mono text-[10px] text-gray-400" : "rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-200"}>{shortcut}</kbd>
					<Tooltip.Arrow className="fill-gray-950" />
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
});

function shouldIgnoreInputs(keys: string, context: CommandContext): boolean {
	if (context === "text-input") return false;
	return !/(^|\+)(mod|control|ctrl|meta)(\+|$)/i.test(keys) && !/^escape$/i.test(keys);
}

export function toAriaKeyShortcut(keys: string): string {
	const parsed = parseHotkey(keys);
	const parts: string[] = [];
	if (parsed.ctrl) parts.push("Control");
	if (parsed.alt) parts.push("Alt");
	if (parsed.shift) parts.push("Shift");
	if (parsed.meta) parts.push("Meta");
	parts.push(parsed.key);
	return parts.join("+");
}
