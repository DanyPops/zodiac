import { Ticket, User } from "lucide";
import { icon } from "../icon.js";
import { type Issue, mockIssues } from "../mock-data.js";
import { issuePriorityBadge, issueStatusBadge } from "../status-badge.js";

function issueRowHtml(issue: Issue): string {
	return `
		<div class="rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white dark:bg-gray-800/60 p-3 space-y-2">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-[11px] font-mono text-gray-400 dark:text-gray-500">${issue.key}</p>
					<p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">${issue.title}</p>
				</div>
				<div class="flex flex-col items-end gap-1 shrink-0">
					${issueStatusBadge(issue.status)}
					${issuePriorityBadge(issue.priority)}
				</div>
			</div>
			<div class="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500">
				<div class="flex items-center gap-1">
					${issue.assignee ? `<span class="issue-assignee-icon"></span><span>${issue.assignee}</span>` : `<span>Unassigned</span>`}
				</div>
				<div class="flex gap-1">
					${issue.labels.map((l) => `<span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">${l}</span>`).join("")}
				</div>
			</div>
		</div>
	`;
}

export function renderTicketsTile(container: HTMLElement): void {
	const issues = mockIssues();
	container.innerHTML = `
		<div class="h-full overflow-auto p-3 space-y-3">
			<div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 px-1">
				<span class="tickets-header-icon"></span>
				<span>Jira \u00b7 Networking / ptp \u00b7 synthetic data</span>
			</div>
			${issues.map(issueRowHtml).join("")}
		</div>
	`;
	container.querySelector(".tickets-header-icon")?.appendChild(icon(Ticket, { size: 14 }));
	for (const el of container.querySelectorAll(".issue-assignee-icon")) {
		el.appendChild(icon(User, { size: 12 }));
	}
}
