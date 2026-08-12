import { useLayoutEffect, useState } from "react";
import type { WispTargetMeasurer } from "../platform/wisp-target-measurer.js";
import type { WispCursorPosition } from "./wisp-cursor.js";

/** Recomputes `measurer.measure(windowIndex)` on resize and whenever `windowIndex` itself changes. Undefined windowIndex means idle -- no target. */
export function useWispCursorTarget(windowIndex: number | undefined, measurer: WispTargetMeasurer): WispCursorPosition | undefined {
	const [target, setTarget] = useState<WispCursorPosition | undefined>(undefined);

	useLayoutEffect(() => {
		if (windowIndex === undefined) {
			setTarget(undefined);
			return;
		}

		function measure(): void {
			setTarget(measurer.measure(windowIndex as number));
		}

		measure();
		return measurer.onResize(measure);
	}, [windowIndex, measurer]);

	return target;
}
