import { useEffect, useMemo, useState } from "react";
import type { Preferences } from "./platform/preferences.js";
import { createBrowserVisualDnaStyleTarget } from "./platform/visual-dna-style.js";
import { clampVisualDna, type VisualDna } from "./platform/visual-dna.js";

export interface VisualDnaHandle {
	value: VisualDna;
	setVibe: (vibe: number) => void;
	setCornerSharpness: (cornerSharpness: number) => void;
}

/**
 * Owns the current VisualDna value: persisted through Preferences, applied
 * to the document as CSS custom properties (`--app-line-width`,
 * `--app-corner-radius`) as a side effect whenever it changes. Mirrors
 * useTheme's split -- the style target's own document access lives in
 * visual-dna-style.ts, not here.
 */
export function useVisualDna(preferences: Preferences): VisualDnaHandle {
	const [value, setValue] = useState<VisualDna>(() => preferences.visualDna());
	const target = useMemo(() => createBrowserVisualDnaStyleTarget(), []);

	useEffect(() => {
		target.apply(value);
	}, [target, value]);

	function update(next: VisualDna): void {
		const clamped = clampVisualDna(next);
		setValue(clamped);
		preferences.setVisualDna(clamped);
	}

	return {
		value,
		setVibe: (vibe) => update({ ...value, vibe }),
		setCornerSharpness: (cornerSharpness) => update({ ...value, cornerSharpness }),
	};
}
