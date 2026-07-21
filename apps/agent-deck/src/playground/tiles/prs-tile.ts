import { mockPullRequests, type PullRequest } from "../mock-data.js";
import { prReviewBadge, prStateBadge } from "../status-badge.js";
import { attachTileHeaderIcon, tileHeaderHtml } from "../tile-header.js";

function prRowHtml(pr: PullRequest): string {
	return `
		<div class="rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 p-3 space-y-2">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-[11px] text-gray-400 dark:text-gray-500">${pr.repo} #${pr.number}</p>
					<p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">${pr.title}</p>
				</div>
				<div class="flex flex-col items-end gap-1 shrink-0">
					${prStateBadge(pr.state)}
					${prReviewBadge(pr.reviewState)}
				</div>
			</div>
			<p class="text-[11px] text-gray-400 dark:text-gray-500">@${pr.author} \u00b7 updated ${new Date(pr.updatedAt).toLocaleDateString()}</p>
		</div>
	`;
}

export function renderPRsTile(container: HTMLElement): void {
	const prs = mockPullRequests();
	container.innerHTML = `
		<div class="h-full overflow-auto p-3 space-y-3">
			${tileHeaderHtml("prs", "Code review \u00b7 synthetic data")}
			${prs.map(prRowHtml).join("")}
		</div>
	`;
	attachTileHeaderIcon(container, "prs");
}
