import { basename, dirname, relative } from "node:path";
import type { ContributionOutcome, ContributionResourceReference } from "@zodiac/protocol";
import type { LectorHost } from "../lector/lector-host.js";
import type { ClassifiedPath } from "./classify-path.js";
import { nearestGitRoot } from "./nearest-git-root.js";

export interface WorkspaceBootstrapBounds {
	readonly maxEntries: number;
	readonly maxBytes: number;
}

export const DEFAULT_WORKSPACE_BOOTSTRAP_BOUNDS: WorkspaceBootstrapBounds = { maxEntries: 500, maxBytes: 1_000_000 };

export interface TreeEntryView {
	readonly name: string;
	readonly kind: "file" | "directory" | "symlink";
}

export interface BootstrappedTree {
	readonly path: string;
	readonly entries: readonly TreeEntryView[];
}

export interface BootstrappedFile {
	readonly path: string;
	readonly content: string;
	readonly resource: ContributionResourceReference;
}

export interface BootstrappedWorkspace {
	/** Local-only: used to resolve a bare file's path relative to its workspace root. Never enters World state -- see workspaceId. */
	readonly rootPath: string;
	readonly rootTitle: string;
	/** Lector's own opaque, content-derived workspace identity (see deriveWorkspaceId) -- the only identifier that may become a Zodiac WorkspaceId. */
	readonly workspaceId: string;
	readonly workspace: ContributionResourceReference;
	readonly kind: "directory" | "file";
	readonly tree?: BootstrappedTree;
	readonly file?: BootstrappedFile;
}

export type BootstrapWorkspaceOutcome = ContributionOutcome<BootstrappedWorkspace>;

function failure(code: string, message: string): BootstrapWorkspaceOutcome {
	return { ok: false, code, message };
}

function record(value: unknown): Record<string, unknown> | undefined {
	// This assertion follows the runtime object/null check and assigns no field semantics --
	// the same defensive-parse convention @danypops/alignment-lector's own contribution uses.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Exported for reuse by any other caller that opens a Lector workspace resource directly (e.g. native-editor.ts's own workspace resolution) -- the same lector://workspace/<id> URI shape, not a second parsing convention. */
export function workspaceIdFromReference(workspace: ContributionResourceReference): string | undefined {
	try {
		const uri = new URL(workspace.uri);
		if (uri.protocol !== "lector:" || uri.hostname !== "workspace") return undefined;
		const id = decodeURIComponent(uri.pathname.slice(1));
		return id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

function parseTree(value: unknown): BootstrappedTree | undefined {
	const parsed = record(value);
	if (!parsed || parsed.kind !== "tree" || typeof parsed.path !== "string" || !Array.isArray(parsed.entries)) return undefined;
	const entries: TreeEntryView[] = [];
	for (const candidate of parsed.entries) {
		const entry = record(candidate);
		if (!entry || typeof entry.name !== "string" || (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink")) return undefined;
		entries.push({ name: entry.name, kind: entry.kind });
	}
	return { path: parsed.path, entries };
}

function parseFileContent(value: unknown): string | undefined {
	const parsed = record(value);
	return parsed && parsed.kind === "text" && typeof parsed.content === "string" ? parsed.content : undefined;
}

/**
 * Resolves the workspace root for a bootstrapped path (the directory itself, or -- for a bare
 * file -- its nearest enclosing git repository, falling back to the file's own directory when
 * it is not inside one), opens that workspace through the Lector host, and, for a bare file,
 * opens and reads that file too. Every failure from the Lector host (unreachable daemon,
 * invalid response, bound exceeded) is returned as a typed outcome, never thrown.
 */
export async function bootstrapWorkspace(
	classified: Extract<ClassifiedPath, { kind: "directory" | "file" }>,
	host: LectorHost,
	bounds: WorkspaceBootstrapBounds = DEFAULT_WORKSPACE_BOOTSTRAP_BOUNDS,
): Promise<BootstrapWorkspaceOutcome> {
	const rootPath = classified.kind === "directory" ? classified.path : (nearestGitRoot(dirname(classified.path)) ?? dirname(classified.path));
	const rootTitle = basename(rootPath) || rootPath;

	const opened = await host.execute("lector.workspace.open", { path: rootPath });
	if (!opened.ok) return opened;
	const workspace = opened.value;
	const workspaceId = workspaceIdFromReference(workspace);
	if (!workspaceId) return failure("invalid-response", "Lector returned an unrecognized workspace resource");

	if (classified.kind === "directory") {
		const listing = await host.read(workspace, bounds);
		if (!listing.ok) return listing;
		const tree = parseTree(listing.value);
		if (!tree) return failure("invalid-response", "Lector returned an unrecognized directory listing");
		return { ok: true, value: { rootPath, rootTitle, workspaceId, workspace, kind: "directory", tree } };
	}

	const relativePath = relative(rootPath, classified.path);
	const openedFile = await host.execute("lector.file.open", { workspaceId, path: relativePath });
	if (!openedFile.ok) return openedFile;
	const fileResource = openedFile.value;
	const text = await host.read(fileResource, bounds);
	if (!text.ok) return text;
	const content = parseFileContent(text.value);
	if (content === undefined) return failure("invalid-response", "Lector returned an unrecognized file read");
	return { ok: true, value: { rootPath, rootTitle, workspaceId, workspace, kind: "file", file: { path: relativePath, content, resource: fileResource } } };
}
