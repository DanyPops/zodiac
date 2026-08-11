import type { ExtensionUIContext, ExtensionUIDialogOptions, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SelectListTheme, TUI } from "@earendil-works/pi-tui";
import { Input, SelectList, type SelectItem } from "@earendil-works/pi-tui";

/**
 * Everything AlignmentExtensionUIContext needs from a real
 * SemanticShellApplication, narrowed to exactly this facade's own
 * requirements -- see SemanticShellApplication's own showExternalComponent/
 * hideExternalComponent/terminalRows/refresh doc comments for how each maps
 * onto the real shell.
 */
export interface AlignmentExtensionUIContextHost {
	showExternalComponent(component: Component): void;
	hideExternalComponent(): void;
	refresh(): void;
	terminalRows(): number;
}

/**
 * Minimal SGR-wrapping fg for a small, deliberate palette -- the same
 * 8-color ANSI space semantic-shell.ts's own BASE/MUTED/ERROR_STYLE
 * constants already commit to project-wide (see ansi-segments.ts's own
 * applyCodes doc comment), not a full theme reimplementation. Covers
 * exactly the ThemeColor names pi-lector's own NeovimEditorComponent/
 * ExplorerComponent actually call (confirmed by reading both files
 * directly) plus the handful of generic ones (error/warning/success) any
 * other real EditorTheme-narrowed consumer would plausibly reach for.
 */
const THEME_COLOR_CODE: Record<string, number> = {
	text: 7,
	muted: 6,
	accent: 5,
	error: 1,
	warning: 3,
	success: 2,
	syntaxKeyword: 5,
	syntaxComment: 6,
	syntaxString: 2,
	syntaxNumber: 3,
	syntaxFunction: 4,
	syntaxType: 6,
};

function sgrFg(code: number, text: string): string {
	return `\x1b[3${code}m${text}\x1b[0m`;
}

/**
 * A real, working stand-in for pi-coding-agent's own `Theme` class --
 * satisfies the narrow `{ fg(color, text), bg(color, text) }` surface every
 * real `.custom()` factory proven live here actually calls (pi-lector's own
 * `EditorTheme` interface), emitting real SGR codes `parseAnsiLine` can
 * recover through `mountComponent`. Never a real `Theme` instance: its
 * constructor requires a full `Record<ThemeColor, ...>` fgColors map and
 * has private fields, so no plain object could satisfy it structurally
 * anyway -- cast at the call site, exactly like fakeTui below (the same
 * pragmatic pattern this whole facade rests on: real code only ever
 * touches a tiny, now-verified slice of these classes' full declared
 * surface).
 */
function createAlignmentEditorTheme(): { fg(color: string, text: string): string; bg(color: string, text: string): string } {
	return {
		fg(color, text) {
			const code = THEME_COLOR_CODE[color];
			return code === undefined ? text : sgrFg(code, text);
		},
		// No real consumer calls bg() today (confirmed: neither
		// NeovimEditorComponent nor ExplorerComponent does) -- kept only for
		// EditorTheme's own interface completeness.
		bg(_color, text) {
			return text;
		},
	};
}

function selectListTheme(): SelectListTheme {
	return {
		selectedPrefix: (text) => sgrFg(5, text),
		selectedText: (text) => `\x1b[7m${text}\x1b[0m`,
		description: (text) => sgrFg(6, text),
		scrollInfo: (text) => sgrFg(6, text),
		noMatch: (text) => sgrFg(1, text),
	};
}

/** Prepends a bold title row above an inner Component's own rendered lines and forwards input -- SelectList/Input have no title concept of their own, and this is the one piece select()/confirm()/input() all three need in common. */
class TitledComponent implements Component {
	constructor(
		private readonly title: string,
		private readonly inner: Component,
	) {}
	render(width: number): string[] {
		return [`\x1b[1m${this.title}\x1b[0m`, ...this.inner.render(width)];
	}
	handleInput(data: string): void {
		this.inner.handleInput?.(data);
	}
	invalidate(): void {
		this.inner.invalidate();
	}
}

/**
 * Alignment's real, working ExtensionUIContext for the in-process
 * AgentSession path -- built once the real coupling surface was traced
 * end to end (not assumed): `TUI`/`KeybindingsManager` are real
 * pi-coding-agent/pi-tui classes with private fields, so no object literal
 * can satisfy them structurally; every real `.custom()` factory this was
 * proven against (pi-lector's NeovimEditorComponent/ExplorerComponent)
 * only ever calls `tui.requestRender()`/`tui.terminal.rows` and ignores
 * `keybindings` entirely (both name the parameter `_keybindings`), so a
 * small fake object cast at the boundary is correct, not a shortcut.
 *
 * `select`/`confirm`/`input` reuse `custom()` internally rather than a
 * second, parallel rendering path -- pi-tui's own generic `SelectList`/
 * `Input` Components, mounted exactly the same way any extension's own
 * Component would be.
 *
 * Every other member (setStatus, setWidget, setFooter, ...) is a deliberate
 * no-op matching pi-coding-agent's own `noOpUIContext` defaults -- real,
 * scoped follow-up work, not an oversight.
 */
export function createAlignmentExtensionUIContext(host: AlignmentExtensionUIContextHost): ExtensionUIContext {
	async function custom<T>(
		factory: (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>,
	): Promise<T> {
		return new Promise<T>((resolve) => {
			const fakeTui = {
				requestRender: () => host.refresh(),
				terminal: {
					get rows() {
						return host.terminalRows();
					},
				},
			};
			// Never read by any real /editor or /explorer consumer proven here
			// (both name this factory parameter `_keybindings`) -- an empty
			// object is enough; nothing calls a method on it.
			const keybindings = {} as unknown as KeybindingsManager;
			const theme = createAlignmentEditorTheme() as unknown as Theme;
			function done(result: T): void {
				host.hideExternalComponent();
				host.refresh();
				resolve(result);
			}
			void Promise.resolve(factory(fakeTui as unknown as TUI, theme, keybindings, done)).then((component) => {
				host.showExternalComponent(component);
				host.refresh();
			});
		});
	}

	async function select(title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
		if (options.length === 0) return undefined;
		return custom<string | undefined>((_tui, _theme, _keybindings, done) => {
			const items: SelectItem[] = options.map((value) => ({ value, label: value }));
			const list = new SelectList(items, Math.max(1, host.terminalRows() - 2), selectListTheme());
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(undefined);
			opts?.signal?.addEventListener("abort", () => done(undefined), { once: true });
			return new TitledComponent(title, list);
		});
	}

	async function confirm(title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> {
		const choice = await select(`${title} -- ${message}`, ["Yes", "No"], opts);
		return choice === "Yes";
	}

	async function input(title: string, _placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
		return custom<string | undefined>((_tui, _theme, _keybindings, done) => {
			const field = new Input();
			field.onSubmit = (value) => done(value);
			field.onEscape = () => done(undefined);
			opts?.signal?.addEventListener("abort", () => done(undefined), { once: true });
			return new TitledComponent(title, field);
		});
	}

	return {
		select,
		confirm,
		input,
		notify: () => {},
		onTerminalInput: () => () => {},
		setStatus: () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom,
		pasteToEditor: () => {},
		setEditorText: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return createAlignmentEditorTheme() as unknown as Theme;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "UI not available" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}
