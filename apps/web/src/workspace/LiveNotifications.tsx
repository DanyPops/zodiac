import { useEffect } from "react";
import { useNotifications } from "../notifications/use-notifications.js";
import type { NotificationsState } from "../notifications/use-notifications.js";

interface LiveNotificationsProps {
	readonly baseUrl: string;
	readonly onPending: (pending: NotificationsState["pending"]) => void;
	/** Called on every render with the current approve/deny closures -- a plain ref write on the caller's side, never a state update, mirroring LiveWorldPanels' own onApply. */
	readonly onActions: (actions: { readonly approve: NotificationsState["approve"]; readonly deny: NotificationsState["deny"] }) => void;
}

/**
 * An invisible bridge, not a visible piece of chrome -- lazy-loaded (see App.tsx's own `lazy()`
 * call for it) for the same reason LiveWorldPanels is: `useNotifications`' real dependency
 * (`@zodiac/server/net`'s `readSseFrames`) is tiny on its own, but this component exists
 * specifically so NotificationsPill's real data source stays out of the critical entry bundle,
 * the same discipline every other live-daemon consumer in this file already follows. Reports the
 * live pending list up via `onPending`, and the current approve/deny closures via `onActions`,
 * whenever either changes.
 */
export function LiveNotifications({ baseUrl, onPending, onActions }: LiveNotificationsProps): null {
	const notifications = useNotifications(baseUrl);
	useEffect(() => {
		onPending(notifications.pending);
	}, [notifications.pending, onPending]);
	// No dependency array, deliberately -- approve/deny are fresh closures every render (never
	// memoized), same reasoning as LiveWorldPanels' own onApply effect.
	useEffect(() => {
		onActions({ approve: notifications.approve, deny: notifications.deny });
	});
	return null;
}
