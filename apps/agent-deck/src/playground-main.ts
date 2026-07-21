import { LayoutGrid, Monitor, Moon, Sun } from "lucide";
import { createDockviewPlayground } from "./playground/dockview-playground.js";
import { icon } from "./playground/icon.js";
import { createBrowserThemeController, type ThemeMode } from "./theme.js";

function modeIcon(mode: ThemeMode) {
	return mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
}

function main(): void {
	const app = document.querySelector<HTMLDivElement>("#app");
	if (!app) return;

	const theme = createBrowserThemeController();

	app.innerHTML = `
		<div class="flex flex-col h-screen p-3 gap-3">
			<header class="flex items-center justify-between px-4 py-2.5 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] shrink-0">
				<div class="flex items-center gap-2.5">
					<span class="app-icon flex items-center justify-center h-8 w-8 rounded-xl bg-accent-10 dark:bg-accent-80 text-accent-60 dark:text-accent-20"></span>
					<div>
						<h1 class="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight">agent-deck</h1>
						<p class="text-xs text-gray-400 dark:text-gray-500">Primitives playground \u00b7 synthetic data</p>
					</div>
				</div>
				<button
					id="theme-toggle"
					class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-200/70 dark:border-gray-700/60 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200"
				>
					<span id="theme-icon"></span>
					<span id="theme-label"></span>
				</button>
			</header>
			<div
				id="dockview-container"
				class="flex-1 min-h-0 rounded-2xl border border-gray-200/70 dark:border-gray-700/60 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.03)] overflow-hidden"
			></div>
		</div>
	`;

	app.querySelector(".app-icon")?.appendChild(icon(LayoutGrid, { size: 18, strokeWidth: 2 }));

	function renderThemeButton(): void {
		const iconSlot = document.querySelector("#theme-icon");
		const labelSlot = document.querySelector("#theme-label");
		if (iconSlot) {
			iconSlot.innerHTML = "";
			iconSlot.appendChild(icon(modeIcon(theme.getMode()), { size: 14 }));
		}
		if (labelSlot) labelSlot.textContent = theme.getMode()[0]!.toUpperCase() + theme.getMode().slice(1);
	}
	renderThemeButton();

	const dockviewContainer = document.querySelector<HTMLDivElement>("#dockview-container");
	if (dockviewContainer) {
		const playground = createDockviewPlayground(dockviewContainer);
		playground.setDark(theme.isDark());
		theme.subscribe((isDark) => playground.setDark(isDark));
	}

	document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => {
		theme.cycleMode();
		renderThemeButton();
	});
}

main();
