import type { IntegrationId } from "@zodiac/protocol";

interface WorldSnapshotForDockCheck {
	readonly workspaces?: ReadonlyArray<{ readonly id: string; readonly activeIntegrationIds?: readonly string[] }>;
}

/** Live per-Workspace docked-Integration set, fetched fresh (not cached from session start) since docking/undocking can happen mid-conversation. Reuses workspaceViewModel's own activeIntegrationIds (Slice 4) rather than re-deriving it from windows/surfaces. Returns an empty set for an unknown Workspace or an unreachable daemon -- callers decide what "no data" should mean for their own authorization/reporting. */
export async function fetchActiveIntegrationIds(fetcher: typeof fetch, daemonUrl: string, workspaceId: string): Promise<ReadonlySet<IntegrationId>> {
	const response = await fetcher(`${daemonUrl}/api/world`);
	if (!response.ok) return new Set();
	const world = (await response.json().catch(() => undefined)) as WorldSnapshotForDockCheck | undefined;
	const ids = world?.workspaces?.find((workspace) => workspace.id === workspaceId)?.activeIntegrationIds ?? [];
	return new Set(ids as readonly IntegrationId[]);
}
