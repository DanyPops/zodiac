/**
 * Placeholder. The real sigma.js graph view over the graphology SessionGraph
 * is a separate task (observability-tile-sigmajs-graph-view-with-semantic-
 * status-c-k85v). This exists so the dockview shell has a second real panel
 * to host instead of an empty div.
 */
export function renderObservabilityView(container: HTMLElement): void {
	container.innerHTML = `
		<div class="h-full flex items-center justify-center p-6 text-center">
			<p class="text-sm text-gray-400 dark:text-gray-500">
				Observability graph view — coming soon.<br />
				<span class="text-xs">(sigma.js over the graphology trace graph)</span>
			</p>
		</div>
	`;
}
