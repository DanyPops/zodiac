import type { CommandId, CommandIntent, Panel, SurfaceId, WorkspaceId, WorkspaceViewModel, WorldChange, WorldViewModel } from "@zodiac/protocol";
import { readSseFrames } from "./net/sse-client.js";
import type { WorldClient } from "./client.js";

/** postCommandIntent's own outcome -- the real, synchronous accept/reject answer WorldClient.apply() deliberately never gives a caller. */
export interface PostCommandOutcome {
	readonly accepted: boolean;
	readonly commandId?: CommandId;
	readonly surfaceId?: SurfaceId;
	/** Present on rejection; a human-readable reason from the daemon's own error response. */
	readonly message?: string;
}

/**
 * One real POST /api/world/commands round trip, returning its actual
 * accept/reject outcome -- unlike WorldClient.apply() (fire-and-forget
 * by design), a caller building optimistic UI needs exactly this
 * synchronous answer to "did MY specific command succeed," since a
 * rejected command never appears in any future WorldViewModel at all.
 * Never throws on a network failure -- reports it as a rejection instead,
 * so a caller has one outcome shape to branch on.
 */
export async function postCommandIntent(baseUrl: string, intent: CommandIntent, fetcher: typeof fetch = fetch): Promise<PostCommandOutcome> {
	try {
		const response = await fetcher(`${baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent }),
		});
		const body = (await response.json().catch(() => ({}))) as { commandId?: string; result?: { surfaceId?: string }; message?: string };
		if (!response.ok) return { accepted: false, message: body.message ?? `daemon rejected the command (${response.status})` };
		return { accepted: true, commandId: body.commandId as CommandId | undefined, surfaceId: body.result?.surfaceId as SurfaceId | undefined };
	} catch (error) {
		return { accepted: false, message: error instanceof Error ? error.message : String(error) };
	}
}

function parseWorldChangeFrame(data: string): WorldChange | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(data);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	const candidate = parsed as { viewModel?: unknown; commandId?: unknown; state?: unknown };
	if (candidate.viewModel && typeof candidate.viewModel === "object") {
		if (candidate.commandId !== undefined && typeof candidate.commandId !== "string") return undefined;
		return { viewModel: candidate.viewModel as WorldViewModel, ...(candidate.commandId !== undefined ? { commandId: candidate.commandId as CommandId } : {}) };
	}
	// Bounded rolling-upgrade compatibility: older daemons sent the raw
	// WorldViewModel as an SSE frame. It cannot acknowledge a command, but it
	// remains a valid state resync while client and daemon versions overlap.
	if (candidate.state === "empty" || candidate.state === "ready") return { viewModel: parsed as WorldViewModel };
	return undefined;
}

export interface RemoteWorldStoreOptions {
	/** Base URL of a running zodiacd instance, e.g. http://127.0.0.1:4390. */
	readonly baseUrl: string;
	readonly fetcher?: typeof fetch;
	/** How long the initial connectivity probe (GET /api/world) waits before giving up -- the signal a caller uses to fall back to an embedded WorldStore instead. Defaults to 2s. */
	readonly connectTimeoutMs?: number;
}

/**
 * A `WorldClient` backed by a real, already-running zodiacd instance
 * instead of an in-process World -- the client half of zodiacd stage 5 (per
 * the "Build zodiacd" Papyrus Task and the Alef prior-art Doc's own
 * RemoteSession precedent: fetch current state once, then an SSE tail for
 * live updates, so a late-attaching client is never left guessing whether
 * it missed something).
 *
 * Returns `WorldClient`, not the wider `WorldStore` -- every caller of
 * `apply()`/`worldViewModel()` in this codebase today (apps/terminal's own
 * `applyBootstrapToWorld` and `SemanticShellApplication`'s own even-narrower
 * `WorldProjection`) never touches `createWorkspace`/`getWorkspace`/
 * `dockSurface`/`undockSurface`/`dockSurfaceInto`/`windowTile`/`snapshot` --
 * those exist on `WorldStore` only for the daemon's own in-process use
 * (apps/service's own snapshot-to-disk hook) and were never meant to cross a
 * wire boundary (their return values are raw domain objects, not the
 * WorldViewModel projection zodiacd's API actually exposes). Forcing this
 * adapter to implement them anyway (as literal `throw "not supported"`
 * stubs) was a real Interface Segregation violation; `WorldStore` remains
 * structurally a superset of `WorldClient`, so a real in-process
 * `WorldStore` (e.g. `createWorldStore()`) is still substitutable anywhere
 * a `WorldClient` is expected -- only the reverse direction (treating
 * this remote adapter as a full `WorldStore`) is no longer offered, because
 * it was never actually true.
 *
 * Rejects if the initial GET /api/world never completes within
 * `connectTimeoutMs` -- the one signal a caller needs to decide "no daemon
 * reachable, fall back to an embedded WorldStore" without hanging
 * indefinitely on a stale/wrong URL.
 */
export async function connectRemoteWorldStore(options: RemoteWorldStoreOptions): Promise<WorldClient & { dispose: () => void }> {
	const { baseUrl } = options;
	const fetcher = options.fetcher ?? fetch;

	const initial = await fetcher(`${baseUrl}/api/world`, { signal: AbortSignal.timeout(options.connectTimeoutMs ?? 2_000) });
	if (!initial.ok) throw new Error(`connectRemoteWorldStore: GET /api/world returned ${initial.status}`);
	let latest = (await initial.json()) as WorldViewModel;

	/** Best-effort: keeps the last-known-good Panel list on a failed fetch, the same degrade-gracefully policy the SSE loop below applies to a malformed WorldViewModel frame. */
	async function fetchPanels(): Promise<readonly Panel[]> {
		try {
			const response = await fetcher(`${baseUrl}/api/world/panels`);
			if (!response.ok) return latestPanels;
			return ((await response.json()) as { panels: readonly Panel[] }).panels;
		} catch {
			return latestPanels;
		}
	}
	let latestPanels: readonly Panel[] = []; // assigned below -- fetchPanels' own not-ok/error fallback reads this, so it must exist before the first call
	latestPanels = await fetchPanels();

	const changeListeners = new Set<(change: WorldChange) => void>();
	const streamController = new AbortController();

	/**
	 * A dropped connection resumes automatically after a short delay (Alef's
	 * own RemoteSession precedent: retry after a fixed 1s on SSE error/close)
	 * -- safe here in a way it deliberately isn't for the agent-session SSE
	 * channel (see @zodiac/pi's http-agent-integration.ts doc comment): every
	 * reconnect's very first frame is always the *current* full
	 * WorldViewModel, never a replayed delta log, so re-subscribing after a
	 * drop is idempotent by construction.
	 */
	async function streamForever(): Promise<void> {
		while (!streamController.signal.aborted) {
			try {
				const response = await fetcher(`${baseUrl}/api/world/events`, { signal: streamController.signal });
				await readSseFrames(response, (data) => {
					const change = parseWorldChangeFrame(data);
					if (!change) return; // malformed frame -- skip, keep the last-known-good state
					latest = change.viewModel;
					for (const listener of changeListeners) listener(change);
					// A panel.move triggers this same broadcast as any other mutation --
					// piggyback a refresh here instead of a second polling loop. Notifies
					// listeners a second time once it lands (same viewModel, fresh panels)
					// so a consumer reading panels() off onChange sees it, without
					// widening onChange's own callback signature to carry panels itself.
					void fetchPanels().then((panels) => {
						latestPanels = panels;
						for (const listener of changeListeners) listener(change);
					});
				});
			} catch {
				if (streamController.signal.aborted) return;
			}
			if (streamController.signal.aborted) return;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	}
	void streamForever();

	return {
		worldViewModel(): WorldViewModel {
			return latest;
		},
		workspaceViewModel(workspaceId: WorkspaceId): WorkspaceViewModel | undefined {
			if (latest.state === "empty") return undefined;
			return latest.workspaces.find((workspace) => workspace.id === workspaceId);
		},
		panels(): readonly Panel[] {
			return latestPanels;
		},
		apply(intent: CommandIntent): void {
			// Fire-and-forget, matching WorldStore.apply()'s own synchronous
			// signature -- a real network call cannot complete synchronously, so
			// success/failure surface asynchronously instead: success arrives as
			// the next SSE frame (worldViewModel() already reflects it once that
			// lands), failure is reported to stderr since there is no synchronous
			// caller left to hand a thrown error to. The intent's own optional
			// commandId (if the caller supplied one) is included in that
			// diagnostic so a failure among several concurrent callers' commands
			// is still attributable to the one that actually failed.
			const label = intent.commandId ? `${intent.type} commandId=${intent.commandId}` : intent.type;
			void fetcher(`${baseUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent }),
			}).then((response) => {
				if (!response.ok) console.error(`connectRemoteWorldStore: apply(${label}) rejected by the daemon (${response.status})`);
			}, (error: unknown) => {
				console.error(`connectRemoteWorldStore: apply(${label}) failed:`, error);
			});
		},
		onChange(listener: (change: WorldChange) => void): () => void {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		dispose(): void {
			streamController.abort();
			changeListeners.clear();
		},
	};
}
