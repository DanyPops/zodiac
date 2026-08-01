/**
 * The app's own "Visual DNA": two independent, continuous dials over the
 * shell's chrome, inspired directly by Excalidraw's sloppiness/roundness
 * controls but re-scoped for a real, interactive application shell rather
 * than freehand-drawn shapes -- see the design Doc for why a literal
 * rough.js-style path jitter was considered and deliberately not applied to
 * elements a user actually clicks and reads.
 */
export interface VisualDna {
	/** 0 = Cartoon (loose, bold lines), 100 = Professional (crisp, thin lines). Comfy sits at the midpoint. */
	readonly vibe: number;
	/** 0 = Square corners, 100 = Circle (as round as each element's own size allows). */
	readonly cornerSharpness: number;
}

export const DEFAULT_VISUAL_DNA: VisualDna = { vibe: 100, cornerSharpness: 50 };

// cornerSharpness 50 -> 16px matches the `rounded-2xl` value already shipped
// as the default shell look; vibe 100 -> 1px matches Tailwind's default
// `border` width already used everywhere. Turning this feature on changes
// nothing visually until a user actually moves a slider.
const MAX_CORNER_RADIUS_PX = 32;
const MIN_LINE_WIDTH_PX = 1;
const MAX_LINE_WIDTH_PX = 3;

export function clampDnaValue(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

export function clampVisualDna(value: VisualDna): VisualDna {
	return { vibe: clampDnaValue(value.vibe), cornerSharpness: clampDnaValue(value.cornerSharpness) };
}

export function isVisualDna(value: unknown): value is VisualDna {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return typeof candidate.vibe === "number" && Number.isFinite(candidate.vibe) && typeof candidate.cornerSharpness === "number" && Number.isFinite(candidate.cornerSharpness);
}

/** Border/divider line weight in px: thin and crisp at Professional, bolder toward Cartoon. */
export function lineWidthPx(vibe: number): number {
	const clamped = clampDnaValue(vibe);
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
export function cornerRadiusPx(cornerSharpness: number): number {
	return (clampDnaValue(cornerSharpness) / 100) * MAX_CORNER_RADIUS_PX;
}
