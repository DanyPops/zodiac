import { useEffect, useMemo, useState } from "react";
import type { Preferences } from "./platform/preferences.js";
import { clampShapeSettings, type ShapeSettings } from "./platform/shape-settings.js";
import { createBrowserShapeSettingsStyleTarget } from "./platform/shape-settings-style.js";

export interface ShapeSettingsHandle {
	value: ShapeSettings;
	setStrokeWidth: (strokeWidth: number) => void;
	setCornerRadius: (cornerRadius: number) => void;
}

/**
 * Owns the current ShapeSettings value: persisted through Preferences,
 * applied to the document as CSS custom properties (`--app-line-width`,
 * `--app-corner-radius`) as a side effect whenever it changes. Mirrors
 * useTheme's split -- the style target's own document access lives in
 * shape-settings-style.ts, not here.
 */
export function useShapeSettings(preferences: Preferences): ShapeSettingsHandle {
	const [value, setValue] = useState<ShapeSettings>(() => preferences.shapeSettings());
	const target = useMemo(() => createBrowserShapeSettingsStyleTarget(), []);

	useEffect(() => {
		target.apply(value);
	}, [target, value]);

	function update(next: ShapeSettings): void {
		const clamped = clampShapeSettings(next);
		setValue(clamped);
		preferences.setShapeSettings(clamped);
	}

	return {
		value,
		setStrokeWidth: (strokeWidth) => update({ ...value, strokeWidth }),
		setCornerRadius: (cornerRadius) => update({ ...value, cornerRadius }),
	};
}
