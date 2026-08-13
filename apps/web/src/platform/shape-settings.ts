/**
 * The app's own Shape settings: two independent, continuous dials over the
 * shell's chrome -- corner radius and stroke width, the same two properties
 * "Shape" covers in Material Design 3 and Fluent 2's own design-token
 * systems. Inspired directly by Excalidraw's sloppiness/roundness controls
 * but re-scoped for a real, interactive application shell rather than
 * freehand-drawn shapes -- see the design Doc for why a literal rough.js-
 * style path jitter was considered and deliberately not applied to elements
 * a user actually clicks and reads.
 */
export interface ShapeSettings {
	/** 0 = Cartoon (loose, bold lines), 100 = Professional (crisp, thin lines). Comfy sits at the midpoint. */
	readonly strokeWidth: number;
	/** 0 = Square corners, 100 = Circle (as round as each element's own size allows). */
	readonly cornerRadius: number;
}

export const DEFAULT_SHAPE_SETTINGS: ShapeSettings = { strokeWidth: 100, cornerRadius: 50 };

// cornerRadius 50 -> 16px matches the `rounded-2xl` value already shipped
// as the default shell look; strokeWidth 100 -> 1px matches Tailwind's
// default `border` width already used everywhere. Turning this feature on
// changes nothing visually until a user actually moves a slider.
const MAX_CORNER_RADIUS_PX = 32;
const MIN_LINE_WIDTH_PX = 1;
const MAX_LINE_WIDTH_PX = 3;

export function clampShapeValue(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

export function clampShapeSettings(value: ShapeSettings): ShapeSettings {
	return { strokeWidth: clampShapeValue(value.strokeWidth), cornerRadius: clampShapeValue(value.cornerRadius) };
}

export function isShapeSettings(value: unknown): value is ShapeSettings {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.strokeWidth === "number" && Number.isFinite(candidate.strokeWidth) && typeof candidate.cornerRadius === "number" && Number.isFinite(candidate.cornerRadius);
}

/** Border/divider line weight in px: thin and crisp at Professional, bolder toward Cartoon. */
export function lineWidthPx(strokeWidth: number): number {
	const clamped = clampShapeValue(strokeWidth);
	return MIN_LINE_WIDTH_PX + ((100 - clamped) / 100) * (MAX_LINE_WIDTH_PX - MIN_LINE_WIDTH_PX);
}

/**
 * Corner radius in px. The cap (32px) isn't an arbitrary style choice: it's
 * comfortably past half the shortest side of every glyph/button-sized
 * element in the shell, so those become true circles well before 100 (CSS
 * clamps `border-radius` to 50% of an element's own box automatically) --
 * exactly the "Square to Circle" metaphor design tools use, where larger
 * panels read as generously rounded rather than literally circular.
 */
export function cornerRadiusPx(cornerRadius: number): number {
	return (clampShapeValue(cornerRadius) / 100) * MAX_CORNER_RADIUS_PX;
}
