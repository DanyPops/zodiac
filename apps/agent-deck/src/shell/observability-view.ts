import type Graph from "graphology";
import Sigma from "sigma";
import { buildRenderGraph } from "./observability-graph.js";

export interface ObservabilityView {
	/** Call when the host panel becomes visible after being hidden (e.g. a dockview tab switch) — sigma can't measure a hidden container. */
	resize(): void;
	dispose(): void;
	/**
	 * Re-applies theme-dependent rendering settings (currently: label color).
	 * Sigma's own default labelColor is a hardcoded "#000" (see sigma's
	 * settings source), never theme-aware — against this app's dark theme
	 * background (#111827) that computes to a 1.18:1 contrast ratio, far
	 * below the WCAG 4.5:1 minimum for text. Call whenever the app-wide
	 * theme changes, matching the pattern DockviewApp.setDark already uses.
	 */
	setDark(isDark: boolean): void;
}

/**
 * Matches this app's own dark:/light: text convention (styles.css --color-gray-100
 * / --color-gray-900) rather than inventing new colors. Verified contrast:
 * dark (#f3f4f6 on #111827) = 16.12:1, light (#111827 on #ffffff) = 17.74:1 --
 * both well above the WCAG 4.5:1 minimum for body text.
 */
function themeLabelColor(isDark: boolean): string {
	return isDark ? "#f3f4f6" : "#111827";
}

/**
 * Renders the graphology trace graph via sigma.js (WebGL). Click a node to
 * highlight its immediate neighborhood (dims everything else); click empty
 * space to clear the selection. Zoom/pan are native sigma camera controls.
 *
 * The status/size/color/layout logic lives in observability-graph.ts, kept
 * separate because it needs to be unit-testable and sigma.js requires a
 * real WebGL context at import time (fails immediately under Node/vitest).
 * This module is the thin, DOM/WebGL-touching half, verified via a headless
 * Chromium smoke test instead of unit tests.
 */
export function renderObservabilityView(container: HTMLElement, graph: Graph): ObservabilityView {
	if (graph.order === 0) {
		container.innerHTML = `
			<div class="h-full flex items-center justify-center p-6 text-center">
				<p class="text-sm text-gray-400 dark:text-gray-500">No graph data yet.</p>
			</div>
		`;
		return { resize(): void {}, dispose(): void {}, setDark(): void {} };
	}

	const renderGraph = buildRenderGraph(graph);

	container.innerHTML = "";
	const sigmaContainer = document.createElement("div");
	// Explicit background rather than relying on dockview's own panel
	// background: DockviewComponent defaults to its built-in "abyss" theme
	// (always dark) unless a `theme` option is passed, so the manual
	// dockview-theme-dark/light class toggle on an outer container doesn't
	// reach this element -- sigma's canvas itself paints transparent, so
	// without this the abyss background always shows through regardless of
	// the app's own theme. Same gray-900/white pairing themeLabelColor()
	// below assumes when computing contrast.
	sigmaContainer.className = "h-full w-full bg-white dark:bg-gray-900";
	container.appendChild(sigmaContainer);

	// dockview can call init() before the browser has finished laying out the
	// panel (container measures 0x0 at that instant), which sigma treats as a
	// hard error. allowInvalidContainer avoids the throw; the ResizeObserver
	// below calls resize() once real dimensions are available, so the graph
	// actually appears instead of silently staying blank.
	// Initial value is corrected immediately by the first setDark() call the
	// caller makes right after construction (see dockview-app.ts / main.ts),
	// before the browser has a chance to paint -- no visible flash of the
	// wrong-theme color.
	const renderer = new Sigma(renderGraph, sigmaContainer, {
		renderLabels: true,
		allowInvalidContainer: true,
		labelColor: { color: themeLabelColor(false) },
	});

	const resizeObserver = new ResizeObserver(() => {
		renderer.resize();
		renderer.refresh();
	});
	resizeObserver.observe(sigmaContainer);

	let selectedNode: string | undefined;

	function refresh(): void {
		renderer.setSetting("nodeReducer", (node, data) => {
			if (!selectedNode) return data;
			if (node === selectedNode || renderGraph.areNeighbors(node, selectedNode)) return data;
			return { ...data, color: "#e5e7eb", label: "", zIndex: 0 };
		});
		renderer.setSetting("edgeReducer", (edge, data) => {
			if (!selectedNode) return data;
			const [source, target] = renderGraph.extremities(edge);
			if (source === selectedNode || target === selectedNode) return data;
			return { ...data, hidden: true };
		});
		renderer.refresh();
	}

	renderer.on("clickNode", ({ node }) => {
		selectedNode = selectedNode === node ? undefined : node;
		refresh();
	});
	renderer.on("clickStage", () => {
		selectedNode = undefined;
		refresh();
	});

	refresh();

	return {
		resize(): void {
			renderer.resize();
			renderer.refresh();
		},
		dispose(): void {
			resizeObserver.disconnect();
			renderer.kill();
		},
		setDark(isDark: boolean): void {
			renderer.setSetting("labelColor", { color: themeLabelColor(isDark) });
			renderer.refresh();
		},
	};
}
