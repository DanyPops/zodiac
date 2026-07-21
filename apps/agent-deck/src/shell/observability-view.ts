import type Graph from "graphology";
import Sigma from "sigma";
import { buildRenderGraph } from "./observability-graph.js";

export interface ObservabilityView {
	/** Call when the host panel becomes visible after being hidden (e.g. a dockview tab switch) — sigma can't measure a hidden container. */
	resize(): void;
	dispose(): void;
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
		return { resize(): void {}, dispose(): void {} };
	}

	const renderGraph = buildRenderGraph(graph);

	container.innerHTML = "";
	const sigmaContainer = document.createElement("div");
	sigmaContainer.className = "h-full w-full";
	container.appendChild(sigmaContainer);

	// dockview can call init() before the browser has finished laying out the
	// panel (container measures 0x0 at that instant), which sigma treats as a
	// hard error. allowInvalidContainer avoids the throw; the ResizeObserver
	// below calls resize() once real dimensions are available, so the graph
	// actually appears instead of silently staying blank.
	const renderer = new Sigma(renderGraph, sigmaContainer, {
		renderLabels: true,
		allowInvalidContainer: true,
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
	};
}
