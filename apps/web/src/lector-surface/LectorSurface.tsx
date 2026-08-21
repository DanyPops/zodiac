import { useCallback, useEffect, useState } from "react";
import type { ContributionResourceReference } from "@zodiac/protocol";
import { registerCue } from "@zodiac/ui";
import type { ContributionClient } from "./client.js";

const BOUNDS = { maxBytes: 512 * 1024, maxEntries: 1_000 } as const;
interface TreeEntry { name: string; kind: "file" | "directory" | "symlink"; resource: ContributionResourceReference }
interface TreeView { kind: "tree"; path: string; entries: readonly TreeEntry[] }
interface TextView { kind: "text"; path: string; content: string; bytes: number }

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}
function tree(value: unknown): TreeView | undefined {
	const candidate = record(value);
	if (candidate?.kind !== "tree" || typeof candidate.path !== "string" || !Array.isArray(candidate.entries)) return undefined;
	const entries: TreeEntry[] = [];
	for (const raw of candidate.entries) {
		const entry = record(raw);
		const resource = record(entry?.resource);
		if (!entry || typeof entry.name !== "string" || (entry.kind !== "file" && entry.kind !== "directory" && entry.kind !== "symlink") || !resource) return undefined;
		if (typeof resource.uri !== "string" || typeof resource.kind !== "string" || typeof resource.title !== "string" || resource.readOnly !== true) return undefined;
		entries.push({ name: entry.name, kind: entry.kind, resource: resource as ContributionResourceReference });
	}
	return { kind: "tree", path: candidate.path, entries };
}
function text(value: unknown): TextView | undefined {
	const candidate = record(value);
	return candidate?.kind === "text" && typeof candidate.path === "string" && typeof candidate.content === "string" && typeof candidate.bytes === "number"
		? { kind: "text", path: candidate.path, content: candidate.content, bytes: candidate.bytes }
		: undefined;
}

export function LectorSurfaceContent({ client }: Readonly<{ client: ContributionClient }>): React.JSX.Element {
	const [rootPath, setRootPath] = useState("");
	const [workspace, setWorkspace] = useState<ContributionResourceReference>();
	const [directory, setDirectory] = useState<TreeView>();
	const [file, setFile] = useState<TextView>();
	const [available, setAvailable] = useState<boolean>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => { void client.list().then((items) => setAvailable(items.some((item) => item.id === "lector"))).catch((cause: unknown) => { setAvailable(false); setError(cause instanceof Error ? cause.message : "Could not load contributions"); }); }, [client]);

	const readDirectory = useCallback(async (resource: ContributionResourceReference): Promise<void> => {
		setBusy(true); setError(undefined);
		try {
			const result = await client.read("lector", resource, BOUNDS);
			if (!result.ok) { setError(result.message); return; }
			const parsed = tree(result.value);
			if (!parsed) { setError("Lector returned an invalid directory view"); return; }
			setDirectory(parsed); setFile(undefined);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "Directory read failed"); }
		finally { setBusy(false); }
	}, [client]);
	const openWorkspace = useCallback(async (): Promise<void> => {
		setBusy(true); setError(undefined);
		try {
			const result = await client.invoke("lector", "lector.workspace.open", { path: rootPath });
			if (!result.ok) { setError(result.message); return; }
			setWorkspace(result.value);
			await readDirectory(result.value);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace open failed"); }
		finally { setBusy(false); }
	}, [client, readDirectory, rootPath]);
	useEffect(() => registerCue(
		{ kind: "lector-surface", id: "lector-open-workspace" },
		{ cue: "Open Lector workspace", description: "Open the configured absolute path in the docked Lector Surface.", run: openWorkspace },
	), [openWorkspace]);
	async function openEntry(entry: TreeEntry): Promise<void> {
		if (entry.kind === "directory") { await readDirectory(entry.resource); return; }
		setBusy(true); setError(undefined);
		try {
			const uri = new URL(entry.resource.uri);
			const workspaceId = decodeURIComponent(uri.pathname.slice(1));
			const path = uri.searchParams.get("path") ?? "";
			const opened = await client.invoke("lector", "lector.file.open", { workspaceId, path });
			if (!opened.ok) { setError(opened.message); return; }
			const read = await client.read("lector", opened.value, BOUNDS);
			if (!read.ok) { setError(read.message); return; }
			const parsed = text(read.value);
			if (!parsed) { setError("Lector returned an invalid text view"); return; }
			setFile(parsed);
		} catch (cause) { setError(cause instanceof Error ? cause.message : "File read failed"); }
		finally { setBusy(false); }
	}

	return <section className="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100" aria-label="Lector workspace">
		<header className="flex gap-2 border-b border-gray-200 p-3 dark:border-gray-800">
			<input aria-label="Workspace path" className="min-w-0 flex-1 rounded border border-gray-300 bg-transparent px-2 py-1 text-sm dark:border-gray-700" value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="/absolute/path/to/project" />
			<button type="button" className="rounded bg-indigo-600 px-3 py-1 text-sm text-white disabled:opacity-50" disabled={!available || busy || rootPath.trim().length === 0} onClick={() => void openWorkspace()}>Open</button>
		</header>
		{available === false && <p className="m-3 rounded bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">Lector is not configured in zodiacd. Start it with the package’s explicit Integration manifest.</p>}
		{error && <p role="alert" className="m-3 rounded bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-100">{error}</p>}
		<div className="grid min-h-0 flex-1 grid-cols-[minmax(12rem,30%)_1fr]">
			<nav aria-label="Files" className="overflow-auto border-r border-gray-200 p-2 dark:border-gray-800">
				<div className="mb-2 truncate text-xs text-gray-500">{directory?.path ?? workspace?.title ?? "No workspace open"}</div>
				{directory?.entries.map((entry) => <button type="button" key={entry.resource.uri} className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-900" onClick={() => void openEntry(entry)}>{entry.kind === "directory" ? "▸" : "·"} {entry.name}</button>)}
			</nav>
			<main className="min-w-0 overflow-auto p-3">{file ? <><div className="mb-2 text-xs text-gray-500">{file.path} · {file.bytes} bytes · read-only</div><pre className="whitespace-pre-wrap break-words font-mono text-xs">{file.content}</pre></> : <p className="text-sm text-gray-500">Select a file to inspect it through Lector.</p>}</main>
		</div>
	</section>;
}
