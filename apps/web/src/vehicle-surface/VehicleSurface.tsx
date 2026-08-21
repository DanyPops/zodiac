import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { VehicleSurfaceInvokeRequest, VehicleSurfaceManifest } from "@zodiac/protocol";
import { registerCue } from "@zodiac/ui";
import type { VehicleSurfaceClient } from "./client.js";

const PAPYRUS_SECTIONS = [
	{ id: "tasks", title: "Tasks", listOperation: "tasks.list" },
	{ id: "docs", title: "Docs", listOperation: "docs.list" },
	{ id: "rules", title: "Rules", listOperation: "rules.list" },
	{ id: "discuss", title: "Discussions", listOperation: "discuss.list" },
] as const;

type PapyrusSection = (typeof PAPYRUS_SECTIONS)[number];

interface ArtifactRow { id?: string; title?: string; name?: string; status?: string; kind?: string }

function artifactRows(value: unknown): readonly ArtifactRow[] {
	if (!Array.isArray(value)) return [];
	return value.filter((row): row is ArtifactRow => typeof row === "object" && row !== null);
}

function taskTransition(status: string | undefined): { operation: string; title: string } | undefined {
	if (status === "todo") return { operation: "tasks.start", title: "Start" };
	if (status === "in-progress") return { operation: "tasks.submit", title: "Submit" };
	if (status === "review") return { operation: "tasks.complete", title: "Complete" };
	return undefined;
}

export interface VehicleSurfaceContentProps {
	readonly surfaceId: string;
	readonly client: VehicleSurfaceClient;
}

export function VehicleSurfaceContent({ surfaceId, client }: VehicleSurfaceContentProps): React.JSX.Element {
	const [manifest, setManifest] = useState<VehicleSurfaceManifest>();
	const [section, setSection] = useState<PapyrusSection>(PAPYRUS_SECTIONS[0]);
	const [projectRoot, setProjectRoot] = useState("");
	const [output, setOutput] = useState<unknown>();
	const [error, setError] = useState<string>();
	const [connection, setConnection] = useState("connecting");
	const [busy, setBusy] = useState(false);
	const lastRequest = useRef<VehicleSurfaceInvokeRequest | undefined>(undefined);
	const cueId = useId();

	const loadManifest = useCallback(async () => {
		try { setManifest(await client.manifest(surfaceId)); setError(undefined); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Vehicle Surface unavailable"); }
	}, [client, surfaceId]);

	const run = useCallback(async (request: VehicleSurfaceInvokeRequest, remember = true) => {
		setBusy(true);
		try {
			const result = await client.invoke(surfaceId, request);
			if (result.ok) { setOutput(result.output); setError(undefined); if (remember) lastRequest.current = request; }
			else setError(`${result.error.code}: ${result.error.message}`);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Vehicle invocation failed");
		} finally {
			setBusy(false);
		}
	}, [client, surfaceId]);

	const operations = useMemo(() => manifest?.operations.filter((operation) => operation.name.startsWith(`${section.id}.`)) ?? [], [manifest, section]);
	const rows = artifactRows(output);
	const listAvailable = manifest?.operations.some((operation) => operation.name === section.listOperation && operation.available) === true;
	const refresh = useCallback(async (): Promise<void> => {
		if (!projectRoot.trim()) { setError("Project root is required for Papyrus views."); return; }
		await run({ name: section.listOperation, version: 1, input: { project_root: projectRoot.trim() } });
	}, [projectRoot, run, section]);

	useEffect(() => { void loadManifest(); }, [loadManifest]);
	useEffect(() => {
		const subscription = client.subscribe(surfaceId, (event) => {
			if (event.type === "state") { setConnection(event.state); return; }
			void loadManifest();
			if (lastRequest.current) void run(lastRequest.current, false);
		});
		return () => subscription.close();
	}, [client, loadManifest, run, surfaceId]);
	useEffect(() => registerCue(
		{ kind: "vehicle-surface", id: `${surfaceId}-refresh-${cueId}` },
		{ cue: `Refresh ${section.title}`, description: `Refresh the active ${section.title} view from the ${surfaceId} Vehicle Surface.`, run: refresh },
	), [cueId, refresh, section.title, surfaceId]);

	async function transition(row: ArtifactRow): Promise<void> {
		const action = taskTransition(row.status);
		if (!action || !row.id) return;
		await run({ name: action.operation, version: 1, input: { id: row.id, project_root: projectRoot.trim() } }, false);
		await refresh();
	}

	let renderedOutput: ReactNode = <p className="text-xs text-gray-500">Choose a project root and refresh this view.</p>;
	if (rows.length > 0) {
		renderedOutput = <ul className="space-y-2">{rows.map((row, index) => {
			const title = row.title ?? row.name ?? row.id ?? `Item ${index + 1}`;
			const action = section.id === "tasks" ? taskTransition(row.status) : undefined;
			return <li key={row.id ?? `${title}-${index}`} className="rounded border border-gray-200 p-2 text-xs dark:border-gray-800"><div className="flex items-center justify-between gap-2"><span className="font-medium">{title}</span><span className="text-gray-500">{row.status ?? row.kind ?? ""}</span></div>{action && row.id ? <button type="button" onClick={() => void transition(row)} className="mt-2 rounded border border-gray-300 px-2 py-1 dark:border-gray-700" aria-label={`${action.title} ${title}`}>{action.title}</button> : null}</li>;
		})}</ul>;
	} else if (output !== undefined) {
		renderedOutput = <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(output, null, 2)}</pre>;
	}

	return (
		<section className="flex h-full min-h-0 flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100" aria-label={manifest?.title ?? "Vehicle Surface"}>
			<header className="border-b border-gray-200 p-3 dark:border-gray-800">
				<div className="flex items-center justify-between gap-3">
					<div><h2 className="text-sm font-semibold">{manifest?.title ?? "Vehicle Surface"}</h2><p className="text-xs text-gray-500">{manifest?.vehicle.description ?? "Connecting to zodiacd…"}</p></div>
					<span className="text-xs capitalize text-gray-500" data-testid="vehicle-surface-state">{connection}</span>
				</div>
				<label className="mt-3 block text-xs text-gray-600 dark:text-gray-300">Project root<input aria-label="Project root" value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} placeholder="/path/to/project" className="mt-1 w-full rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700" /></label>
			</header>
			<nav className="flex gap-1 border-b border-gray-200 p-2 dark:border-gray-800" aria-label="Papyrus artifact kinds">
				{PAPYRUS_SECTIONS.map((candidate) => <button type="button" key={candidate.id} onClick={() => { setSection(candidate); setOutput(undefined); }} className={`rounded px-2 py-1 text-xs ${section.id === candidate.id ? "bg-gray-200 dark:bg-gray-800" : ""}`}>{candidate.title}</button>)}
			</nav>
			<div className="flex items-center justify-between gap-2 px-3 py-2">
				<button type="button" disabled={busy || !listAvailable} onClick={() => void refresh()} className="rounded border border-gray-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-gray-700">{busy ? "Working…" : `Refresh ${section.title}`}</button>
				<span className="text-[11px] text-gray-500">{operations.length} operation{operations.length === 1 ? "" : "s"}</span>
			</div>
			{error ? <p role="alert" className="px-3 pb-2 text-xs text-red-600">{error}</p> : null}
			<div className="min-h-0 flex-1 overflow-auto px-3 pb-3">{renderedOutput}</div>
		</section>
	);
}
