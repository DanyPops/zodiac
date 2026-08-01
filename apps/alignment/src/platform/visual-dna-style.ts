import { cornerRadiusPx, lineWidthPx, type VisualDna } from "./visual-dna.js";

interface StyleHost {
	style: { setProperty: (name: string, value: string) => void };
}

/**
 * Driven port: applying a VisualDna value to the document, independent of
 * the DOM APIs used to do it. `createBrowserVisualDnaStyleTarget` is the
 * only adapter; nothing above this interface reaches into `document`
 * directly -- the same split `theme.ts` uses for the same reason.
 */
export interface VisualDnaStyleTarget {
	apply: (value: VisualDna) => void;
}

export function createVisualDnaStyleTarget(host: StyleHost): VisualDnaStyleTarget {
	return {
		apply(value) {
			host.style.setProperty("--app-line-width", `${lineWidthPx(value.vibe)}px`);
			host.style.setProperty("--app-corner-radius", `${cornerRadiusPx(value.cornerSharpness)}px`);
		},
	};
}

/** Convenience constructor using the real document. Not unit-tested directly — it's a one-line wire-up over createVisualDnaStyleTarget, which is. */
export function createBrowserVisualDnaStyleTarget(): VisualDnaStyleTarget {
	return createVisualDnaStyleTarget(document.documentElement);
}
