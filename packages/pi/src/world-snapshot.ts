import type { IntegrationId, WorkspaceId } from "@zodiac/protocol";

interface WorldSnapshotForDockCheck {
	readonly workspaces?: ReadonlyArray<{ readonly id: string; readonly title?: string; readonly activeIntegrationIds?: readonly string[] }>;
}

async function fetchWorldSnapshot(fetcher: typeof fetch, daemonUrl: string): Promise<WorldSnapshotForDockCheck | undefined> {
	const response = await fetcher(`${daemonUrl}/api/world`);
	if (!response.ok) return undefined;
	return (await response.json().catch(() => undefined)) as WorldSnapshotForDockCheck | undefined;
}

/** Live per-Workspace docked-Integration set, fetched fresh (not cached from session start) since docking/undocking can happen mid-conversation. Reuses workspaceViewModel's own activeIntegrationIds (Slice 4) rather than re-deriving it from windows/surfaces. Returns an empty set for an unknown Workspace or an unreachable daemon -- callers decide what "no data" should mean for their own authorization/reporting. */
export async function fetchActiveIntegrationIds(fetcher: typeof fetch, daemonUrl: string, workspaceId: string): Promise<ReadonlySet<IntegrationId>> {
	const world = await fetchWorldSnapshot(fetcher, daemonUrl);
	const ids = world?.workspaces?.find((workspace) => workspace.id === workspaceId)?.activeIntegrationIds ?? [];
	return new Set(ids as readonly IntegrationId[]);
}

/** Every real Workspace's own {id, title}, live from the same /api/world snapshot -- backs list_workspaces. Returns an empty array for an unreachable daemon or a still-empty World, never throws -- "no Workspaces exist yet" is a real, honest answer, not a failure. */
export async function fetchWorkspaceSummaries(fetcher: typeof fetch, daemonUrl: string): Promise<readonly { readonly id: WorkspaceId; readonly title: string }[]> {
	const world = await fetchWorldSnapshot(fetcher, daemonUrl);
	return (world?.workspaces ?? []).map((workspace) => ({ id: workspace.id as WorkspaceId, title: workspace.title ?? workspace.id }));
}
