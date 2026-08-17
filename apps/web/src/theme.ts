export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "zodiac.theme";
// A real, no-longer-current localStorage namespace (agent-deck, the
// product's prior name) an existing user's browser may still hold.
const LEGACY_STORAGE_KEYS = ["agent-deck-theme"];
const VALID_MODES: readonly ThemeMode[] = ["light", "dark", "system"]; 

// Text color changes immediately when the theme flips. Animating it creates a
// brief low-contrast midpoint even though both endpoint colors pass contrast.
export const THEME_TOGGLE_CLASSES =
	"text-xs font-medium px-3 py-1.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-[background-color,border-color]";

type ThemeListener = (isDark: boolean, mode: ThemeMode) => void;

/**
 * Driven port: theme state and its effect on the document, independent of
 * the DOM APIs used to apply it. `createBrowserThemeController` is the only
 * adapter; nothing above this interface reaches into `document` directly.
 */
export interface ThemeController {
	getMode: () => ThemeMode;
	setMode: (mode: ThemeMode) => void;
	cycleMode: () => void;
	isDark: () => boolean;
	/** Returns an unsubscribe function. */
	subscribe: (listener: ThemeListener) => () => void;
	dispose: () => void;
}

interface ThemeControllerDeps {
	documentElement: { classList: { toggle: (cls: string, force?: boolean) => void } };
	storage: Storage;
	matchMedia: (query: string) => MediaQueryList;
}

function loadStoredMode(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): ThemeMode {
	try {
		const stored = storage.getItem(STORAGE_KEY);
		if (stored !== null && (VALID_MODES as readonly string[]).includes(stored)) return stored as ThemeMode;

		for (const legacyKey of LEGACY_STORAGE_KEYS) {
			const legacy = storage.getItem(legacyKey);
			if (legacy !== null && (VALID_MODES as readonly string[]).includes(legacy)) {
				storage.setItem(STORAGE_KEY, legacy);
				storage.removeItem(legacyKey);
				return legacy as ThemeMode;
			}
		}
	} catch {
		// Storage may be unavailable in privacy-restricted hosts.
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
	let disposed = false;
	const listeners = new Set<ThemeListener>();

	function apply(): void {
		if (disposed) return;
		const dark = resolveDark(mode, media);
		documentElement.classList.toggle("dark", dark);
		for (const listener of listeners) listener(dark, mode);
	}

	const handleMediaChange = () => {
		if (mode === "system") apply();
	};
	media.addEventListener("change", handleMediaChange);

	apply();

	const controller: ThemeController = {
		getMode: () => mode,
		setMode(next: ThemeMode) {
			if (disposed || !VALID_MODES.includes(next)) return;
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
			if (disposed) return () => undefined;
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			listeners.clear();
			media.removeEventListener("change", handleMediaChange);
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
