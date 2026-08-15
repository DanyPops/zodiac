import type { CommandIntent, Surface, Workspace, WorkspaceId, WorkspaceViewModel, WorldId, WorldViewModel } from "@zodiac/protocol";
import { worldId as makeWorldId } from "@zodiac/protocol";
import { readSseFrames } from "../net/sse-client.js";
import type { WorldStore } from "./store.js";

export interface RemoteWorldStoreOptions {
	/** Base URL of a running zodiacd instance, e.g. http://127.0.0.1:4390. */
	readonly baseUrl: string;
	/**
	 * Cosmetic only -- zodiacd's own /api/world routes never expose a World's
	 * id over the wire (WorldViewModel has no id field at all; only the
	 * daemon's own startup log line reads WorldStore.id locally). Defaults to
	 * the same "zodiac" id apps/terminal's own embedded createWorldStore call
	 * already uses, so a caller never has to invent one just to satisfy the
	 * type.
	 */
	readonly id?: WorldId;
	readonly fetcher?: typeof fetch;
	/** How long the initial connectivity probe (GET /api/world) waits before giving up -- the signal a caller uses to fall back to an embedded WorldStore instead. Defaults to 2s. */
	readonly connectTimeoutMs?: number;
}

const NOT_SUPPORTED = "is not available over a remote WorldStore -- zodiacd's own /api/world routes expose only worldViewModel() (GET) and apply() (POST .../commands); dispatch the equivalent CommandIntent through apply() instead.";

/**
 * A `WorldStore` backed by a real, already-running zodiacd instance instead
 * of an in-process World -- the client half of zodiacd stage 5 (per the
 * "Build zodiacd" Papyrus Task and the Alef prior-art Doc's own
 * RemoteSession precedent: fetch current state once, then an SSE tail for
 * live updates, so a late-attaching client is never left guessing whether
 * it missed something).
 *
 * Every caller of `apply()`/`worldViewModel()` in this codebase today
 * (apps/terminal's own `applyBootstrapToWorld` and `SemanticShellApplication`)
 * never touches `createWorkspace`/`getWorkspace`/`dockSurface`/
 * `undockSurface`/`snapshot` -- those exist on `WorldStore` only for the
 * daemon's own in-process use (apps/service's own snapshot-to-disk hook)
 * and were never meant to cross a wire boundary (their return values are raw
 * domain objects, not the WorldViewModel projection zodiacd's API actually
 * exposes). This adapter still implements the full interface, so it's a
 * drop-in `WorldStore` wherever one is expected, but those specific methods
 * throw a clear, actionable error instead of silently returning nonsense if
 * a future caller ever does reach them.
 *
 * Rejects if the initial GET /api/world never completes within
 * `connectTimeoutMs` -- the one signal a caller needs to decide "no daemon
 * reachable, fall back to an embedded WorldStore" without hanging
 * indefinitely on a stale/wrong URL.
 */
export async function connectRemoteWorldStore(options: RemoteWorldStoreOptions): Promise<WorldStore & { dispose: () => void }> {
	const { baseUrl } = options;
	const fetcher = options.fetcher ?? fetch;
	const id = options.id ?? makeWorldId("zodiac");

	const initial = await fetcher(`${baseUrl}/api/world`, { signal: AbortSignal.timeout(options.connectTimeoutMs ?? 2_000) });
	if (!initial.ok) throw new Error(`connectRemoteWorldStore: GET /api/world returned ${initial.status}`);
	let latest = (await initial.json()) as WorldViewModel;

	const changeListeners = new Set<(viewModel: WorldViewModel) => void>();
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
					try {
						latest = JSON.parse(data) as WorldViewModel;
					} catch {
						return; // malformed frame -- skip, keep the last-known-good state
					}
					for (const listener of changeListeners) listener(latest);
				});
			} catch {
				if (streamController.signal.aborted) return;
			}
			if (streamController.signal.aborted) return;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
	}
	void streamForever();

	function notSupported(method: string): never {
		throw new Error(`connectRemoteWorldStore: ${method}() ${NOT_SUPPORTED}`);
	}

	return {
		id,
		worldViewModel(): WorldViewModel {
			return latest;
		},
		workspaceViewModel(workspaceId: WorkspaceId): WorkspaceViewModel | undefined {
			if (latest.state === "empty") return undefined;
			return latest.workspaces.find((workspace) => workspace.id === workspaceId);
		},
		apply(intent: CommandIntent): void {
			// Fire-and-forget, matching WorldStore.apply()'s own synchronous
			// signature -- a real network call cannot complete synchronously, so
			// success/failure surface asynchronously instead: success arrives as
			// the next SSE frame (worldViewModel() already reflects it once that
			// lands), failure is reported to stderr since there is no synchronous
			// caller left to hand a thrown error to.
			void fetcher(`${baseUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent }),
			}).then((response) => {
				if (!response.ok) console.error(`connectRemoteWorldStore: apply(${intent.type}) rejected by the daemon (${response.status})`);
			}, (error: unknown) => {
				console.error(`connectRemoteWorldStore: apply(${intent.type}) failed:`, error);
			});
		},
		onChange(listener: (viewModel: WorldViewModel) => void): () => void {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		snapshot(): never {
			notSupported("snapshot");
		},
		getWorkspace(_workspaceId: WorkspaceId): Workspace | undefined {
			notSupported("getWorkspace");
		},
		createWorkspace(_workspaceId: WorkspaceId, _title: string): Workspace {
			notSupported("createWorkspace");
		},
		dockSurface(_workspaceId: WorkspaceId, _integrationId: Parameters<WorldStore["dockSurface"]>[1], _title: string): Surface {
			notSupported("dockSurface");
		},
		undockSurface(_workspaceId: WorkspaceId, _surfaceId: Parameters<WorldStore["undockSurface"]>[1]): void {
			notSupported("undockSurface");
		},
		dispose(): void {
			streamController.abort();
			changeListeners.clear();
		},
	};
}
