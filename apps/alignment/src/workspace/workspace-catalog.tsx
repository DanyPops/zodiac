import { Bug, Flag, GitPullRequest, LineChart, Megaphone, MessageCircle, Rocket, Terminal } from "lucide-react";
import type { ComponentType } from "react";
import { addWindow, createWorkspace, selectWindow, type Workspace } from "./model.js";

interface WorkspaceGlyphIconProps {
	"aria-hidden"?: boolean | "true" | "false";
	size?: number;
	className?: string;
}

/** The fixed set of glyphs offered when creating a new Workspace -- a component reference can't round-trip through Preferences, so a SavedWorkspace persists one of these keys instead (see workspace-catalog.tsx's isSavedWorkspace/useUserWorkspaces). */
export const WORKSPACE_GLYPH_OPTIONS: Readonly<Record<string, ComponentType<WorkspaceGlyphIconProps>>> = {
	bug: Bug,
	metrics: LineChart,
	chat: MessageCircle,
	prs: GitPullRequest,
	rocket: Rocket,
	terminal: Terminal,
	flag: Flag,
	announcement: Megaphone,
};

export const DEFAULT_WORKSPACE_GLYPH_ID = "flag";

/** A glyph id that doesn't name a known option (e.g. one from a since-removed WORKSPACE_GLYPH_OPTIONS entry) falls back to the default rather than rendering nothing. */
export function resolveWorkspaceGlyph(glyphId: string): ComponentType<WorkspaceGlyphIconProps> {
	return WORKSPACE_GLYPH_OPTIONS[glyphId] ?? WORKSPACE_GLYPH_OPTIONS[DEFAULT_WORKSPACE_GLYPH_ID]!;
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

/**
 * How many empty Windows to seed each mock Workspace with, and where to
 * start -- mock demo data only, so the Window Carousel's centered/fading
 * layout (see window-carousel-fade.ts) is visible without first having to
 * open several Windows by hand. A real Workspace registry would start each
 * new Workspace with exactly one Window, as `createWorkspace` itself does.
 */
const MOCK_DEMO_WINDOW_COUNT = 7;

/** Builds one catalog entry's initial Workspace, pre-seeded with MOCK_DEMO_WINDOW_COUNT empty Windows centered on the middle one -- demo scaffolding, not a real persisted Workspace's actual starting state. */
export function createDemoWorkspace(id: string, title: string): Workspace {
	let workspace = createWorkspace({ id, title });
	for (let count = 1; count < MOCK_DEMO_WINDOW_COUNT; count += 1) workspace = addWindow(workspace);
	return selectWindow(workspace, Math.floor(MOCK_DEMO_WINDOW_COUNT / 2));
}
