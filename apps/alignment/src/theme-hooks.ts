import { useEffect, useRef } from "react";
import { createBrowserThemeController, type ThemeController } from "./theme.js";

/** Owns the browser ThemeController's lifecycle and returns a stable function to cycle its mode -- callers never see the controller or its ref. */
export function useThemeCycle(): () => void {
	const controllerRef = useRef<ThemeController>(undefined);

	useEffect(() => {
		const controller = createBrowserThemeController();
		controllerRef.current = controller;
		return () => {
			if (controllerRef.current === controller) controllerRef.current = undefined;
			controller.dispose();
		};
	}, []);

	return () => controllerRef.current?.cycleMode();
}
