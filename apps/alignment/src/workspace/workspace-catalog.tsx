import { Bug, GitPullRequest, LineChart, MessageCircle } from "lucide-react";
import type { ComponentType } from "react";

interface WorkspaceGlyphIconProps {
	"aria-hidden"?: boolean | "true" | "false";
	size?: number;
	className?: string;
}

/** One selectable Workspace in the left pillar -- a glyph, not a first-letter-of-title initial, since a Workspace's identity is what kind of work it holds, not its name. */
export interface WorkspaceCatalogEntry {
	readonly id: string;
	readonly title: string;
	readonly icon: ComponentType<WorkspaceGlyphIconProps>;
}

/**
 * Mock Workspaces, for now: a real Workspace registry (user-created,
 * persisted, backed by real project/issue-tracker/CI data) is future work.
 * These four exist to demonstrate the corrected model -- a Workspace is its
 * own independent Canvas, never the same thing as a Conversation. "Chat" is
 * a Workspace whose own primary docked content happens to be conversational
 * (e.g. the Conversation Surface docked into its center); it is not the
 * floating Conversation Chat Surface itself, which stays global and can
 * hover over -- or be docked into -- any of these, including this one.
 */
export const WORKSPACE_CATALOG: readonly WorkspaceCatalogEntry[] = [
	{ id: "bug", title: "Bug", icon: Bug },
	{ id: "metrics", title: "Metrics", icon: LineChart },
	{ id: "chat", title: "Chat", icon: MessageCircle },
	{ id: "prs", title: "PRs", icon: GitPullRequest },
];
