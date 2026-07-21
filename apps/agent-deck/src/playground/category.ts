import { GitBranch, GitPullRequest, TerminalSquare, Ticket, Workflow, type IconNode } from "lucide";

/**
 * One bright, distinct identity color per SDLC stage, reusing this app's
 * existing saturated tokens (styles.css @theme) rather than inventing new
 * hues -- used here for category identity (which dock is this), a
 * different job from the same tokens' other use as status severity.
 */
export type CategoryId = "ci" | "tickets" | "terminal" | "prs" | "workflow";

export interface CategoryStyle {
	label: string;
	icon: IconNode;
	/** Tailwind text-color classes for icon + accent text. */
	text: string;
	/** Tailwind background classes for a soft icon chip. */
	chipBg: string;
	/** Tailwind classes for a solid accent bar/border (top of content, tab underline). */
	accentBorder: string;
	/** Raw hex, for contexts needing an inline style value (e.g. SVG). */
	hex: string;
}

export const CATEGORIES: Record<CategoryId, CategoryStyle> = {
	ci: {
		label: "CI",
		icon: GitBranch,
		text: "text-accent-60 dark:text-accent-20",
		chipBg: "bg-accent-10 dark:bg-accent-80",
		accentBorder: "border-accent-50",
		hex: "#0066cc",
	},
	tickets: {
		label: "Tickets",
		icon: Ticket,
		text: "text-info-60 dark:text-info-20",
		chipBg: "bg-info-10 dark:bg-info-80",
		accentBorder: "border-info-50",
		hex: "#5e40be",
	},
	prs: {
		label: "PRs",
		icon: GitPullRequest,
		text: "text-teal-60 dark:text-teal-20",
		chipBg: "bg-teal-10 dark:bg-teal-80",
		accentBorder: "border-teal-50",
		hex: "#37a3a3",
	},
	terminal: {
		label: "Terminal",
		icon: TerminalSquare,
		text: "text-success-60 dark:text-success-20",
		chipBg: "bg-success-10 dark:bg-success-80",
		accentBorder: "border-success-50",
		hex: "#63993d",
	},
	workflow: {
		label: "Workflow",
		icon: Workflow,
		text: "text-warning-60 dark:text-warning-20",
		chipBg: "bg-warning-10 dark:bg-warning-80",
		accentBorder: "border-warning-30",
		hex: "#ffcc17",
	},
};
