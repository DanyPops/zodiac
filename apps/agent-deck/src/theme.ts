export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "agent-deck-theme";
const VALID_MODES: readonly ThemeMode[] = ["light", "dark", "system"];

type ThemeListener = (isDark: boolean, mode: ThemeMode) => void;

export interface ThemeController {
	getMode(): ThemeMode;
	setMode(mode: ThemeMode): void;
	cycleMode(): void;
	isDark(): boolean;
	/** Returns an unsubscribe function. */
	subscribe(listener: ThemeListener): () => void;
}

interface ThemeControllerDeps {
	documentElement: { classList: { toggle(cls: string, force?: boolean): void } };
	storage: Storage;
	matchMedia: (query: string) => MediaQueryList;
}

function loadStoredMode(storage: Pick<Storage, "getItem">): ThemeMode {
	try {
		const stored = storage.getItem(STORAGE_KEY);
		if (stored !== null && (VALID_MODES as readonly string[]).includes(stored)) {
			return stored as ThemeMode;
		}
	} catch {
		// storage unavailable (e.g. privacy mode) — fall through to default
	}
	return "system";
}

function resolveDark(mode: ThemeMode, media: Pick<MediaQueryList, "matches">): boolean {
	return mode === "dark" || (mode === "system" && media.matches);
}

/**
 * Theme controller: light/dark/system, persisted, prefers-color-scheme aware.
 * Dependencies are injected rather than reaching for `document`/`window`
 * globals directly, so the logic is testable with plain mocks (see
 * theme.test.ts) and portable to non-browser hosts (e.g. an Electron
 * renderer with its own document) without change.
 *
 * Toggles Tailwind's `dark` class per the v4 class-based dark variant
 * (`@custom-variant dark (&:where(.dark, .dark *));` in styles.css) — kept
 * deliberately generic (no dockview-specific code here) so the dockview
 * shell task can subscribe and sync its own theme class without touching
 * this module.
 */
export function createThemeController(deps: ThemeControllerDeps): ThemeController {
	const { documentElement, storage, matchMedia } = deps;
	const media = matchMedia("(prefers-color-scheme: dark)");

	let mode: ThemeMode = loadStoredMode(storage);
	const listeners = new Set<ThemeListener>();

	function apply(): void {
		const dark = resolveDark(mode, media);
		documentElement.classList.toggle("dark", dark);
		for (const listener of listeners) listener(dark, mode);
	}

	media.addEventListener("change", () => {
		if (mode === "system") apply();
	});

	apply();

	const controller: ThemeController = {
		getMode: () => mode,
		setMode(next: ThemeMode) {
			if (!VALID_MODES.includes(next)) return;
			mode = next;
			try {
				storage.setItem(STORAGE_KEY, next);
			} catch {
				// ignore storage write failures
			}
			apply();
		},
		cycleMode() {
			const order: readonly ThemeMode[] = ["light", "dark", "system"];
			const currentIndex = order.indexOf(mode);
			const next = order[(currentIndex + 1) % order.length];
			if (next !== undefined) controller.setMode(next);
		},
		isDark: () => resolveDark(mode, media),
		subscribe(listener: ThemeListener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};

	return controller;
}

/** Convenience constructor using real browser globals. Not unit-tested directly — it's a one-line wire-up over createThemeController, which is. */
export function createBrowserThemeController(): ThemeController {
	return createThemeController({
		documentElement: document.documentElement,
		storage: window.localStorage,
		matchMedia: (query: string) => window.matchMedia(query),
	});
}
