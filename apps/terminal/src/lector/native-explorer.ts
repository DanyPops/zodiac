import type { ContributionReadBounds, ContributionResourceReference } from "@zodiac/protocol";
import { type DirectoryExplorerSession, ExplorerComponent, type ExplorerFlowHost, type ExplorerResult, runExplorerFlow } from "@danypops/pi-lector/editor";
import { nearestGitRoot } from "../bootstrap/nearest-git-root.js";
import { workspaceIdFromReference } from "../bootstrap/workspace-bootstrap.js";
import { createAlignmentEditorTheme } from "../pi/alignment-extension-ui-context.js";
import type { LectorHost } from "./lector-host.js";
import { fakeTui, openLectorEditorNatively, type NativeEditorHost } from "./native-editor.js";

/**
 * Alignment's own native host surface for mounting a real Lector explorer Component -- the exact
 * same NativeEditorHost interface native-editor.ts already defines, reused as-is (see this file's
 * own doc comment: explorer and editor both ultimately mount into the same SemanticShellApplication
 * machinery, and neither needs a field the other doesn't already have).
 */
const READ_BOUNDS: ContributionReadBounds = { maxBytes: 4 * 1024 * 1024, maxEntries: 10_000 };

function record(value: unknown): Record<string, unknown> | undefined {
	// Same tiny defensive-parse convention deliberately duplicated in every file that needs it in
	// this codebase (native-editor.ts, workspace-bootstrap.ts, alignment-lector's own
	// contribution.ts) rather than shared -- see those files' own comments on why.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

interface TreeEntry {
	readonly name: string;
	readonly kind: "file" | "directory" | "symlink";
}

function parseTree(value: unknown): { path: string; entries: TreeEntry[] } | undefined {
	const parsed = record(value);
	if (!parsed || parsed.kind !== "tree" || typeof parsed.path !== "string" || !Array.isArray(parsed.entries)) return undefined;
	const entries: TreeEntry[] = [];
	for (const candidate of parsed.entries) {
		const entry = record(candidate);
		if (!entry || typeof entry.name !== "string" || (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink")) return undefined;
		entries.push({ name: entry.name, kind: entry.kind });
	}
	return { path: parsed.path, entries };
}

/**
 * Builds the same `lector://workspace/<id>?path=<path>` resource reference alignment-lector's own
 * contribution.ts constructs internally (its `reference()` helper) and workspace-bootstrap.ts
 * already parses the reverse of (`workspaceIdFromReference`) -- confirmed identical by direct
 * source read, not guessed. Constructing it here for an arbitrary relative path is safe: it's a
 * pure client-side identity, not a capability grant -- alignment-lector's own readResource decodes
 * any workspace-kind URI the same structural way regardless of how the caller built it, exactly
 * like it already does when mapping a directory listing's own child entries into resources.
 */
function workspaceResource(workspaceId: string, path: string): ContributionResourceReference {
	// title has a real min-length-1 schema floor (ContributionResourceReferenceSchema) -- "" (the
	// resolved root) needs a real fallback, the same "/" convention alignment-lector's own bootstrap
	// path already uses for a root-relative empty path.
	return { uri: `lector://workspace/${encodeURIComponent(workspaceId)}?path=${encodeURIComponent(path)}`, kind: "workspace", title: path || "/", readOnly: true };
}

/**
 * Builds a DirectoryExplorerSession backed entirely by Alignment's own lector-host.ts contribution
 * commands -- the five new mutation commands (lector.file.create/delete, lector.directory.create/
 * delete, lector.path.rename) plus a directly-constructed workspace resource read for listDirectory,
 * exactly mirroring createLectorEditorHost's own precedent of never touching pi-lector's own
 * lectorClient()/operations.ts internals.
 */
function createLectorExplorerSession(lectorHost: LectorHost, workspaceId: string, rootPath: string): DirectoryExplorerSession {
	async function mutate(commandId: string, input: unknown): Promise<void> {
		const outcome = await lectorHost.execute(commandId, input);
		if (!outcome.ok) throw new Error(outcome.message);
	}

	return {
		root: rootPath,
		workspaceId,
		async listDirectory(relativePath) {
			const read = await lectorHost.read(workspaceResource(workspaceId, relativePath), READ_BOUNDS);
			if (!read.ok) throw new Error(read.message);
			const tree = parseTree(read.value);
			if (!tree) throw new Error("Lector returned an unrecognized directory listing");
			return tree;
		},
		createFile: (relativePath) => mutate("lector.file.create", { workspaceId, path: relativePath }),
		createDirectory: (relativePath) => mutate("lector.directory.create", { workspaceId, path: relativePath }),
		renamePath: (oldRelativePath, newRelativePath) => mutate("lector.path.rename", { workspaceId, oldPath: oldRelativePath, newPath: newRelativePath }),
		deleteFile: (relativePath) => mutate("lector.file.delete", { workspaceId, path: relativePath }),
		deleteDirectory: (relativePath) => mutate("lector.directory.delete", { workspaceId, path: relativePath }),
	};
}

/**
 * Opens `rootPath`'s real Lector explorer, natively -- no AgentSession, no ExtensionRunner, no Pi
 * extension involvement at all, the exact same guarantee openLectorEditorNatively already makes.
 * Resolves the nearest git root as its Lector workspace, then drives pi-lector's own already-tested
 * runExplorerFlow loop (browse, open a file into the real editor via openLectorEditorNatively,
 * return to the explorer at that file's own directory once it quits) via an ExplorerFlowHost
 * implementation backed by this app's own showExternalComponent/hideExternalComponent mounting --
 * the browse/open/return *policy* stays entirely inside pi-lector; this only supplies how a
 * Component actually gets shown and hidden in this one app.
 */
export async function openLectorExplorerNatively(host: NativeEditorHost, lectorHost: LectorHost, rootPathHint: string): Promise<void> {
	const rootPath = nearestGitRoot(rootPathHint) ?? rootPathHint;
	const opened = await lectorHost.execute("lector.workspace.open", { path: rootPath });
	if (!opened.ok) throw new Error(`Could not open workspace for "${rootPath}": ${opened.message}`);
	const workspaceId = workspaceIdFromReference(opened.value);
	if (!workspaceId) throw new Error(`Lector returned an unrecognized workspace resource for "${rootPath}"`);

	const session = createLectorExplorerSession(lectorHost, workspaceId, rootPath);
	const theme = createAlignmentEditorTheme();

	const flowHost: ExplorerFlowHost = {
		showExplorer: (explorerSession, relativePath) =>
			new Promise<ExplorerResult>((resolve) => {
				function done(result: ExplorerResult): void {
					host.hideExternalComponent();
					host.refresh();
					resolve(result);
				}
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- same
				// pragmatic cast openLectorEditorNatively already relies on for ModalEditorComponent:
				// ExplorerComponent's real coupling surface is exactly {requestRender, terminal.rows}
				// and {fg, bg}, proven by direct source read, not pi-coding-agent's full TUI/Theme
				// classes (which have private fields no plain object can satisfy structurally).
				const component = new ExplorerComponent(fakeTui(host) as any, theme as any, explorerSession, relativePath, done);
				host.showExternalComponent(component);
				host.refresh();
			}),
		showEditor: (absolutePath) => openLectorEditorNatively(host, lectorHost, absolutePath),
	};

	await runExplorerFlow(session, flowHost);
}
