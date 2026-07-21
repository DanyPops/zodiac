import { type CIRun, type CIStageNode, mockCIRuns } from "../mock-data.js";
import { runStatusBadge } from "../status-badge.js";
import { attachTileHeaderIcon, tileHeaderHtml } from "../tile-header.js";

function formatDuration(ms?: number): string {
	if (!ms) return "";
	const totalMin = Math.round(ms / 60000);
	if (totalMin < 60) return `${totalMin}m`;
	return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

function stageHtml(stage: CIStageNode): string {
	const dotTone =
		stage.status === "success"
			? "bg-success"
			: stage.status === "failure"
				? "bg-danger"
				: stage.status === "running"
					? "bg-accent animate-pulse"
					: stage.status === "aborted"
						? "bg-warning"
						: "bg-gray-300 dark:bg-gray-600";
	return `
		<div class="flex flex-col items-center gap-1 min-w-[86px]">
			<div class="h-2.5 w-2.5 rounded-full ${dotTone}"></div>
			<p class="text-[11px] text-gray-600 dark:text-gray-300 text-center leading-tight">${stage.name}</p>
			${stage.durationMs ? `<p class="text-[10px] text-gray-400 dark:text-gray-500">${formatDuration(stage.durationMs)}</p>` : ""}
		</div>
	`;
}

function runCardHtml(run: CIRun): string {
	return `
		<div class="rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 p-3 space-y-3">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">${run.name}</p>
					<p class="text-[11px] text-gray-400 dark:text-gray-500">${new Date(run.startedAt).toLocaleString()} \u00b7 ${formatDuration(run.durationMs)}</p>
				</div>
				${runStatusBadge(run.status)}
			</div>
			<div class="flex items-center gap-2 overflow-x-auto pb-1">
				${run.stages
					.map(
						(stage, i) => `
					${stageHtml(stage)}
					${i < run.stages.length - 1 ? '<div class="h-px w-4 bg-gray-200 dark:bg-gray-700 shrink-0"></div>' : ""}
				`,
					)
					.join("")}
			</div>
		</div>
	`;
}

export function renderCITile(container: HTMLElement): void {
	const runs = mockCIRuns();
	container.innerHTML = `
		<div class="h-full overflow-auto p-3 space-y-3">
			${tileHeaderHtml("ci", "Continuous integration \u00b7 synthetic data")}
			${runs.map(runCardHtml).join("")}
		</div>
	`;
	attachTileHeaderIcon(container, "ci");
}
