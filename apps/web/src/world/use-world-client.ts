import { useEffect, useRef, useState } from "react";
import type { CommandIntent, WorldViewModel } from "@zodiac/protocol";
import { connectRemoteWorldStore, type WorldClientPort } from "@zodiac/server/world-client";

export interface UseWorldClientOptions {
	/** Injectable for tests -- defaults to the browser global, same convention as createHttpTerminalClient/createHttpConversationClient. */
	readonly fetcher?: typeof fetch;
}

export interface WorldClientState {
	/** The daemon's real current WorldViewModel once connected; a real, valid empty WorldViewModel (never null/undefined) before connecting or if the daemon is unreachable, so a consumer never needs a loading-vs-empty special case beyond `connected` itself. */
	readonly viewModel: WorldViewModel;
	/** False before the initial GET /api/world resolves, and permanently false if it never does (a wrong URL, no daemon listening) -- see connectRemoteWorldStore's own doc comment for that same fallback policy. */
	readonly connected: boolean;
	/** Dispatches one CommandIntent through the exact daemon endpoint (`POST /api/world/commands`) a human UI action and story 7's agent tool both already use. A harmless no-op while disconnected -- there is nowhere to send it yet. */
	readonly apply: (intent: CommandIntent) => void;
}

const DISCONNECTED_VIEW_MODEL: WorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

function noopApply(): void {
	// Disconnected: nothing to dispatch to yet -- see WorldClientState.apply's own doc comment.
}

/**
 * Gives apps/web a live connection to a real zodiacd's WorldStore for the
 * first time (see the "story 6 Web half" task's own scope-correcting
 * finding: apps/web/src/workspace/model.ts's Workspace/Window/Surface model
 * is a fully local mock with no daemon connection at all). Wraps the exact
 * same `connectRemoteWorldStore` adapter apps/terminal's cli.ts already
 * uses, over the same narrow `WorldClientPort` -- so this hook and the
 * TUI's own render loop (semantic-shell.ts's paintBody()) consume identical
 * wire data, never two independently-maintained projections of it.
 *
 * Never throws on a failed or slow connection: exposes `connected: false`
 * and a real (empty) `viewModel` instead, so a consuming component can
 * always render something rather than needing its own error boundary for
 * "no daemon reachable" -- a real, expected state for a UI that must still
 * paint.
 */
export function useWorldClient(baseUrl: string, options: UseWorldClientOptions = {}): WorldClientState {
	const { fetcher } = options;
	const [viewModel, setViewModel] = useState<WorldViewModel>(DISCONNECTED_VIEW_MODEL);
	const [connected, setConnected] = useState(false);
	const applyRef = useRef<(intent: CommandIntent) => void>(noopApply);

	useEffect(() => {
		let disposed = false;
		let store: (WorldClientPort & { dispose: () => void }) | undefined;

		setConnected(false);
		setViewModel(DISCONNECTED_VIEW_MODEL);
		applyRef.current = noopApply;

		connectRemoteWorldStore({ baseUrl, fetcher })
			.then((connected) => {
				if (disposed) {
					connected.dispose();
					return;
				}
				store = connected;
				applyRef.current = connected.apply;
				setViewModel(connected.worldViewModel());
				setConnected(true);
				connected.onChange(setViewModel);
			})
			.catch(() => {
				// Stays disconnected -- see this function's own doc comment.
			});

		return () => {
			disposed = true;
			store?.dispose();
		};
	}, [baseUrl, fetcher]);

	return { viewModel, connected, apply: (intent) => applyRef.current(intent) };
}
