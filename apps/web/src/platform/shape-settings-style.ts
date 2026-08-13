import { cornerRadiusPx, lineWidthPx, type ShapeSettings } from "./shape-settings.js";

interface StyleHost {
	style: { setProperty: (name: string, value: string) => void };
}

/**
 * Driven port: applying a ShapeSettings value to the document, independent
 * of the DOM APIs used to do it. `createBrowserShapeSettingsStyleTarget` is
 * the only adapter; nothing above this interface reaches into `document`
 * directly -- the same split `theme.ts` uses for the same reason.
 */
export interface ShapeSettingsStyleTarget {
	apply: (value: ShapeSettings) => void;
}

export function createShapeSettingsStyleTarget(host: StyleHost): ShapeSettingsStyleTarget {
	return {
		apply(value) {
			host.style.setProperty("--app-line-width", `${lineWidthPx(value.strokeWidth)}px`);
			host.style.setProperty("--app-corner-radius", `${cornerRadiusPx(value.cornerRadius)}px`);
		},
	};
}

/** Convenience constructor using the real document. Not unit-tested directly — it's a one-line wire-up over createShapeSettingsStyleTarget, which is. */
export function createBrowserShapeSettingsStyleTarget(): ShapeSettingsStyleTarget {
	return createShapeSettingsStyleTarget(document.documentElement);
}
