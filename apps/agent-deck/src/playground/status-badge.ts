/**
 * Shared status -> color mapping across all playground tiles, reusing this
 * app's existing semantic tokens (styles.css @theme) rather than inventing
 * new ones. Danger is orange (--color-danger), never red -- see doc
 * design-tokens-red-hat-informed-not-red-hat-branded-rm7c.
 */
export type BadgeTone = "success" | "danger" | "warning" | "accent" | "info" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
	success: "bg-success-10 text-success-80 dark:bg-success-80 dark:text-success-10",
	danger: "bg-danger-10 text-danger-80 dark:bg-danger-80 dark:text-danger-10",
	warning: "bg-warning-10 text-warning-80 dark:bg-warning-80 dark:text-warning-10",
	accent: "bg-accent-10 text-accent-70 dark:bg-accent-80 dark:text-accent-10",
	info: "bg-info-10 text-info-80 dark:bg-info-80 dark:text-info-10",
	neutral: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
};

export function badgeHtml(label: string, tone: BadgeTone): string {
	return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${TONE_CLASSES[tone]}">${label}</span>`;
}

const RUN_STATUS_TONE: Record<string, BadgeTone> = {
	pending: "neutral",
	running: "accent",
	success: "success",
	failure: "danger",
	aborted: "warning",
	not_found: "neutral",
};

const ISSUE_STATUS_TONE: Record<string, BadgeTone> = {
	backlog: "neutral",
	todo: "neutral",
	in_progress: "accent",
	in_review: "info",
	done: "success",
	canceled: "warning",
};

const ISSUE_PRIORITY_TONE: Record<string, BadgeTone> = {
	urgent: "danger",
	high: "warning",
	medium: "accent",
	low: "neutral",
	none: "neutral",
};

const PR_REVIEW_TONE: Record<string, BadgeTone> = {
	APPROVED: "success",
	CHANGES_REQUESTED: "danger",
	COMMENTED: "info",
	PENDING: "neutral",
};

const PR_STATE_TONE: Record<string, BadgeTone> = {
	open: "accent",
	merged: "success",
	closed: "warning",
};

export function runStatusBadge(status: string): string {
	return badgeHtml(status.replace(/_/g, " "), RUN_STATUS_TONE[status] ?? "neutral");
}
export function issueStatusBadge(status: string): string {
	return badgeHtml(status.replace(/_/g, " "), ISSUE_STATUS_TONE[status] ?? "neutral");
}
export function issuePriorityBadge(priority: string): string {
	return badgeHtml(priority, ISSUE_PRIORITY_TONE[priority] ?? "neutral");
}
export function prReviewBadge(state: string): string {
	return badgeHtml(state.replace(/_/g, " ").toLowerCase(), PR_REVIEW_TONE[state] ?? "neutral");
}
export function prStateBadge(state: string): string {
	return badgeHtml(state, PR_STATE_TONE[state] ?? "neutral");
}
