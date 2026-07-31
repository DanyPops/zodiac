import { describe, expect, it } from "vitest";
import { createThemeController, THEME_TOGGLE_CLASSES } from "./theme.js";

describe("theme toggle styling", () => {
	it("does not animate text color while the theme changes", () => {
		expect(THEME_TOGGLE_CLASSES).toContain("transition-[background-color,border-color]");
		expect(THEME_TOGGLE_CLASSES).not.toContain("transition-colors");
	});
});

/**
 * Plain mocks, no jsdom: createThemeController takes its DOM/storage/media
 * dependencies as arguments rather than reaching for browser globals, so the
 * logic is fully testable without a real document.
 */
function createMocks(initialMatches = false) {
	const classListToggles: Array<[string, boolean | undefined]> = [];
	const documentElement = {
		classList: {
			toggle(cls: string, force?: boolean): void {
				classListToggles.push([cls, force]);
			},
		},
	};

	const store = new Map<string, string>();
	const storage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		key: () => null,
		length: 0,
	} as Storage;

	let changeListener: (() => void) | undefined;
	let removeListenerCalls = 0;
	// Kept as a plain mutable object (not cast to MediaQueryList) so `matches`
	// can be reassigned in triggerMediaChange; the real MediaQueryList type
	// declares `matches` read-only, which is correct for the browser API but
	// would block mutating this mock.
	const mediaQueryList = {
		matches: initialMatches,
		addEventListener: (_type: string, listener: () => void) => {
			changeListener = listener;
		},
		removeEventListener: () => {
			removeListenerCalls += 1;
			changeListener = undefined;
		},
	};

	return {
		documentElement,
		storage,
		matchMedia: () => mediaQueryList as unknown as MediaQueryList,
		classListToggles,
		removeListenerCalls: () => removeListenerCalls,
		triggerMediaChange(newMatches: boolean): void {
			mediaQueryList.matches = newMatches;
			changeListener?.();
		},
	};
}

describe("createThemeController", () => {
	it("defaults to system mode with no persisted preference", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);
		expect(controller.getMode()).toBe("system");
	});

	it("loads the Alignment preference before any legacy value", () => {
		const mocks = createMocks(false);
		mocks.storage.setItem("alignment.theme", "light");
		mocks.storage.setItem("agent-deck-theme", "dark");
		const controller = createThemeController(mocks);
		expect(controller.getMode()).toBe("light");
	});

	it("migrates a valid legacy preference into the Alignment namespace", () => {
		const mocks = createMocks(false);
		mocks.storage.setItem("agent-deck-theme", "dark");
		const controller = createThemeController(mocks);
		expect(controller.getMode()).toBe("dark");
		expect(mocks.storage.getItem("alignment.theme")).toBe("dark");
	});

	it("ignores an invalid persisted value and falls back to system", () => {
		const mocks = createMocks(false);
		mocks.storage.setItem("alignment.theme", "solarized");
		const controller = createThemeController(mocks);
		expect(controller.getMode()).toBe("system");
	});

	it("resolves dark in system mode according to the media query", () => {
		const darkMocks = createMocks(true);
		expect(createThemeController(darkMocks).isDark()).toBe(true);

		const lightMocks = createMocks(false);
		expect(createThemeController(lightMocks).isDark()).toBe(false);
	});

	it("setMode('dark') toggles the dark class on and persists the choice", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);
		mocks.classListToggles.length = 0; // clear the initial apply() from construction

		controller.setMode("dark");

		expect(mocks.classListToggles.at(-1)).toEqual(["dark", true]);
		expect(mocks.storage.getItem("alignment.theme")).toBe("dark");
		expect(controller.isDark()).toBe(true);
	});

	it("setMode('light') toggles the dark class off even if the system prefers dark", () => {
		const mocks = createMocks(true);
		const controller = createThemeController(mocks);

		controller.setMode("light");

		expect(mocks.classListToggles.at(-1)).toEqual(["dark", false]);
		expect(controller.isDark()).toBe(false);
	});

	it("cycleMode advances light -> dark -> system -> light", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);

		controller.setMode("light");
		controller.cycleMode();
		expect(controller.getMode()).toBe("dark");
		controller.cycleMode();
		expect(controller.getMode()).toBe("system");
		controller.cycleMode();
		expect(controller.getMode()).toBe("light");
	});

	it("re-applies only when a system-preference change occurs while in system mode", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);
		controller.setMode("light");
		mocks.classListToggles.length = 0;

		mocks.triggerMediaChange(true);
		expect(mocks.classListToggles).toHaveLength(0); // mode is "light", not "system" -> ignored

		controller.setMode("system");
		mocks.classListToggles.length = 0;
		mocks.triggerMediaChange(true);
		expect(mocks.classListToggles.at(-1)).toEqual(["dark", true]);
	});

	it("removes its media listener and subscribers on dispose", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);
		const calls: string[] = [];
		controller.subscribe(() => calls.push("notified"));

		controller.dispose();
		mocks.triggerMediaChange(true);
		controller.setMode("dark");

		expect(mocks.removeListenerCalls()).toBe(1);
		expect(calls).toEqual([]);
	});

	it("notifies subscribers on every apply, and unsubscribing stops further notifications", () => {
		const mocks = createMocks(false);
		const controller = createThemeController(mocks);
		const calls: Array<[boolean, string]> = [];
		const unsubscribe = controller.subscribe((isDark, mode) => calls.push([isDark, mode]));

		controller.setMode("dark");
		expect(calls.at(-1)).toEqual([true, "dark"]);

		unsubscribe();
		controller.setMode("light");
		expect(calls).toHaveLength(1); // no new call after unsubscribing
	});
});
