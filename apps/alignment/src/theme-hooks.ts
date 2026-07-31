import { useEffect, useRef, useState } from "react";
import { createBrowserThemeController, type ThemeController } from "./theme.js";

export interface ThemeHandle {
	isDark: boolean;
	cycleTheme: () => void;
}

/**
 * Owns the browser ThemeController's lifecycle -- one instance for the whole
 * app -- and exposes the resolved light/dark state reactively (for anything
 * that needs to pick a matching theme object, e.g. the docking engine)
 * alongside a stable cycle function. Callers never see the controller or its
 * ref directly.
 */
export function useTheme(): ThemeHandle {
	const controllerRef = useRef<ThemeController>(undefined);
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		const controller = createBrowserThemeController();
		controllerRef.current = controller;
		setIsDark(controller.isDark());
		const unsubscribe = controller.subscribe((dark) => setIsDark(dark));
		return () => {
			unsubscribe();
			if (controllerRef.current === controller) controllerRef.current = undefined;
			controller.dispose();
		};
	}, []);

	return { isDark, cycleTheme: () => controllerRef.current?.cycleMode() };
}
