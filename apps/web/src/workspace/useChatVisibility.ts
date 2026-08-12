import { useEffect, useState } from "react";
import type { PointerTracker } from "../platform/pointer.js";

const DEFAULT_EDGE_THRESHOLD_PX = 8;
const DEFAULT_INACTIVITY_MS = 1500;

export interface ChatVisibilityOptions {
	visible: boolean;
	show: () => void;
	hide: () => void;
	pointerTracker: PointerTracker;
	edgeThresholdPx?: number;
	inactivityMs?: number;
}

export interface ChatVisibilityHandle {
	onPointerEnter: () => void;
	onPointerLeave: () => void;
	onFocusCapture: () => void;
	onBlurCapture: () => void;
}

/**
 * Drives the floating Chat Surface's reveal/hide policy: summoned by the
 * pointer reaching the bottom screen edge (or a keymap toggling `visible`
 * directly, owned by the caller), hidden again after `inactivityMs` of being
 * neither hovered nor focused. Hovering or focusing the panel itself
 * (`onPointerEnter`/`onFocusCapture`) resets the clock; the countdown only
 * starts once both signals say the panel is unattended.
 */
export function useChatVisibility({ visible, show, hide, pointerTracker, edgeThresholdPx = DEFAULT_EDGE_THRESHOLD_PX, inactivityMs = DEFAULT_INACTIVITY_MS }: ChatVisibilityOptions): ChatVisibilityHandle {
	const [pointerOver, setPointerOver] = useState(false);
	const [focusWithin, setFocusWithin] = useState(false);
	const active = pointerOver || focusWithin;

	useEffect(() => pointerTracker.onMove((clientY, viewportHeight) => {
		if (clientY >= viewportHeight - edgeThresholdPx) show();
	}), [pointerTracker, edgeThresholdPx, show]);

	useEffect(() => {
		if (!visible || active) return;
		const timeoutId = setTimeout(hide, inactivityMs);
		return () => clearTimeout(timeoutId);
	}, [visible, active, inactivityMs, hide]);

	return {
		onPointerEnter: () => setPointerOver(true),
		onPointerLeave: () => setPointerOver(false),
		onFocusCapture: () => setFocusWithin(true),
		onBlurCapture: () => setFocusWithin(false),
	};
}
