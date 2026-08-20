import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { readSseFrames } from "./net/sse-client.js";

/** One frame shape notification-routes.ts's own SSE stream ever produces. */
type NotificationFrame =
	| { readonly type: "notifications.snapshot"; readonly pending: readonly VehicleApprovalRequest[] }
	| { readonly type: "vehicle.approval.requested"; readonly payload: VehicleApprovalRequest }
	| { readonly type: "vehicle.approval.resolved"; readonly payload: { readonly requestId: string } };

function isNotificationFrame(value: unknown): value is NotificationFrame {
	return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

export interface NotificationsClientPort {
	/** The current pending list -- empty before the initial SSE snapshot frame arrives. */
	pending(): readonly VehicleApprovalRequest[];
	/** Fire-and-forget POST to the daemon's own approve endpoint -- success arrives as the next SSE frame, same convention as WorldClient.apply(). */
	approve(requestId: string): void;
	/** Fire-and-forget POST to the daemon's own deny endpoint, same reasoning as approve(). */
	deny(requestId: string): void;
	/** Called with the full current pending list whenever it changes. */
	onChange(listener: (pending: readonly VehicleApprovalRequest[]) => void): () => void;
}

export interface RemoteNotificationsOptions {
	/** Base URL of a running zodiacd instance. */
	readonly baseUrl: string;
	readonly fetcher?: typeof fetch;
}

/**
 * The client half of the "Wire a live daemon->browser notification transport" Papyrus Task --
 * mirrors connectRemoteWorldStore's own shape and reconnect-forever discipline exactly (fetch
 * current state via the stream's own first frame, then an SSE tail for live updates; a dropped
 * connection resumes automatically after a short delay; every reconnect's own first frame is
 * always the *current* full pending snapshot, never a replayed delta log, so re-subscribing
 * after a drop is idempotent by construction). Lives in this package, not in apps/web, for the
 * same architectural-boundary reason `@zodiac/world`'s own remote-world-store.ts does: apps/web's
 * own ESLint rules ban a literal `fetch` global reference outside a small adapter allowlist --
 * `fetcher ?? fetch` belongs in one real adapter factory, not scattered across every React hook
 * that needs one.
 */
export function connectRemoteNotifications(options: RemoteNotificationsOptions): NotificationsClientPort & { dispose: () => void } {
	const { baseUrl } = options;
	const fetcher = options.fetcher ?? fetch;

	let latest: readonly VehicleApprovalRequest[] = [];
	const changeListeners = new Set<(pending: readonly VehicleApprovalRequest[]) => void>();
	const streamController = new AbortController();

	function applyFrame(frame: NotificationFrame): void {
		switch (frame.type) {
			case "notifications.snapshot":
				latest = frame.pending;
				break;
			case "vehicle.approval.requested":
				latest = [...latest.filter((request) => request.requestId !== frame.payload.requestId), frame.payload];
				break;
			case "vehicle.approval.resolved":
				latest = latest.filter((request) => request.requestId !== frame.payload.requestId);
				break;
		}
		for (const listener of changeListeners) listener(latest);
	}

	async function streamForever(): Promise<void> {
		while (!streamController.signal.aborted) {
			try {
				const response = await fetcher(`${baseUrl}/api/notifications`, { signal: streamController.signal });
				await readSseFrames(response, (data) => {
					let parsed: unknown;
					try {
						parsed = JSON.parse(data);
					} catch {
						return; // malformed frame -- skip, keep the last-known-good state
					}
					if (isNotificationFrame(parsed)) applyFrame(parsed);
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
		pending(): readonly VehicleApprovalRequest[] {
			return latest;
		},
		approve(requestId: string): void {
			void fetcher(`${baseUrl}/api/notifications/${requestId}/approve`, { method: "POST" }).catch(() => {});
		},
		deny(requestId: string): void {
			void fetcher(`${baseUrl}/api/notifications/${requestId}/deny`, { method: "POST" }).catch(() => {});
		},
		onChange(listener: (pending: readonly VehicleApprovalRequest[]) => void): () => void {
			changeListeners.add(listener);
			return () => changeListeners.delete(listener);
		},
		dispose(): void {
			streamController.abort();
			changeListeners.clear();
		},
	};
}
