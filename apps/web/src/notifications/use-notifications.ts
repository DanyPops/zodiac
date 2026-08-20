import { useEffect, useRef, useState } from "react";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { connectRemoteNotifications, type NotificationsClientPort } from "@zodiac/notifications";

export interface UseNotificationsOptions {
	/** Injectable for tests -- defaults to the browser global, same convention as useWorldClient. */
	readonly fetcher?: typeof fetch;
}

export interface NotificationsState {
	/** The daemon's real current pending list once connected; empty before connecting or if the daemon is unreachable -- same always-render-something fallback policy as useWorldClient's own viewModel. */
	readonly pending: readonly VehicleApprovalRequest[];
	/** Fire-and-forget approve, matching NotificationsClientPort.approve()'s own convention. */
	readonly approve: (requestId: string) => void;
	/** Fire-and-forget deny, matching NotificationsClientPort.deny()'s own convention. */
	readonly deny: (requestId: string) => void;
}

/**
 * apps/web's first live connection to zodiacd's own Notifications transport (per the "Wire a
 * live daemon->browser notification transport" Papyrus Task) -- before this,
 * NotificationsPill.tsx's `pending`/`onApprove`/`onDeny` were plain, hand-fed props with no real
 * daemon connection at all (its own doc comment named this gap explicitly).
 *
 * A thin React wrapper over `connectRemoteNotifications` (`@zodiac/notifications`),
 * exactly how `useWorldClient` wraps `connectRemoteWorldStore` -- the real fetch/SSE-reconnect
 * logic (and its own `fetcher ?? fetch` default) lives in that adapter, not here, per this
 * repo's own architecture boundary (apps/web's ESLint config bans a literal `fetch` global
 * reference outside one small adapter allowlist).
 */
export function useNotifications(baseUrl: string, options: UseNotificationsOptions = {}): NotificationsState {
	const { fetcher } = options;
	const [pending, setPending] = useState<readonly VehicleApprovalRequest[]>([]);
	const clientRef = useRef<NotificationsClientPort | undefined>(undefined);

	useEffect(() => {
		setPending([]);
		clientRef.current = undefined;

		const client = connectRemoteNotifications({ baseUrl, fetcher });
		clientRef.current = client;
		setPending(client.pending());
		const unsubscribe = client.onChange(setPending);

		return () => {
			unsubscribe();
			client.dispose();
			clientRef.current = undefined;
		};
	}, [baseUrl, fetcher]);

	return {
		pending,
		// No-op while disconnected (mirrors WorldClientState.apply's own fallback policy) -- there is
		// nowhere to send it yet.
		approve(requestId) {
			clientRef.current?.approve(requestId);
		},
		deny(requestId) {
			clientRef.current?.deny(requestId);
		},
	};
}
