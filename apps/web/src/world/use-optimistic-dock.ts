import { useCallback, useEffect, useState } from "react";
import type { CommandId, CommandIntent, IntegrationId, SurfaceId, WindowId, WorkspaceId } from "@zodiac/protocol";
import { commandId as makeCommandId, surfaceId as makeSurfaceId } from "@zodiac/protocol/ids";
import { postCommandIntent, type PostCommandOutcome } from "@zodiac/world";

export interface DockRequest {
	readonly workspaceId: WorkspaceId;
	readonly integrationId: IntegrationId;
	readonly title: string;
	readonly windowId?: WindowId;
}

export interface PendingDock {
	readonly commandId: CommandId;
	readonly surfaceId: SurfaceId;
	readonly integrationId: IntegrationId;
	readonly title: string;
}

export interface UseOptimisticDockResult {
	/** Surfaces this client docked but that haven't yet been confirmed present in a real WorldViewModel -- render these as a "pending" tile alongside the real ones. */
	readonly pending: readonly PendingDock[];
	/** The most recent rejection's message, if any -- cleared as soon as another dock() is attempted. */
	readonly lastError: string | undefined;
	readonly dock: (request: DockRequest) => void;
}

let dockCounter = 0;

async function dispatchDock(baseUrl: string, intent: CommandIntent, fetcher: typeof fetch | undefined): Promise<PostCommandOutcome> {
	return fetcher ? postCommandIntent(baseUrl, intent, fetcher) : postCommandIntent(baseUrl, intent);
}

function settleDock(outcome: PostCommandOutcome, rejectedSurfaceId: SurfaceId, setPending: (updater: (current: readonly PendingDock[]) => readonly PendingDock[]) => void, setLastError: (message: string) => void): void {
	if (outcome.accepted) return; // stays pending until the reconcile effect sees it in a real WorldViewModel
	setPending((current) => current.filter((entry) => entry.surfaceId !== rejectedSurfaceId));
	setLastError(outcome.message ?? "Dock command rejected by the daemon.");
}

/**
 * The identity/authority fix for apps/web's own dock flow (see the
 * "replace the mock Workspace catalog" epic, Issue A): renders a Surface
 * optimistically the instant dock() is called (a client-generated
 * surfaceId, not the daemon's), then reconciles against the generic bounded
 * command-acknowledgement window -- confirmed when a World broadcast carries
 * this dock's commandId, rolled back with a real error if the daemon rejects the
 * command outright (a collision, an invalid Window). Uses postCommandIntent
 * (a real request/response round trip) rather than WorldClient.apply()
 * (fire-and-forget by design) -- "did MY dock command succeed" is exactly
 * the synchronous accept/reject question a rejected command's own response
 * answers and a future onChange frame never will.
 */
export function useOptimisticDock(baseUrl: string, acknowledgedCommandIds: readonly CommandId[], fetcher?: typeof fetch): UseOptimisticDockResult {
	const [pending, setPending] = useState<readonly PendingDock[]>([]);
	const [lastError, setLastError] = useState<string | undefined>(undefined);

	useEffect(() => {
		if (pending.length === 0 || acknowledgedCommandIds.length === 0) return;
		const acknowledged = new Set(acknowledgedCommandIds);
		setPending((current) => current.filter((entry) => !acknowledged.has(entry.commandId)));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [acknowledgedCommandIds]);

	const dock = useCallback(
		(request: DockRequest) => {
			dockCounter += 1;
			const newSurfaceId = makeSurfaceId(`optimistic-surface-${dockCounter}`);
			const newCommandId = makeCommandId(`optimistic-command-${dockCounter}`);
			setLastError(undefined);
			setPending((current) => [...current, { commandId: newCommandId, surfaceId: newSurfaceId, integrationId: request.integrationId, title: request.title }]);

			const intent: CommandIntent = { type: "surface.dock", workspaceId: request.workspaceId, integrationId: request.integrationId, title: request.title, windowId: request.windowId, surfaceId: newSurfaceId, commandId: newCommandId };
			void dispatchDock(baseUrl, intent, fetcher).then((outcome) => settleDock(outcome, newSurfaceId, setPending, setLastError));
		},
		[baseUrl, fetcher],
	);

	return { pending, lastError, dock };
}
