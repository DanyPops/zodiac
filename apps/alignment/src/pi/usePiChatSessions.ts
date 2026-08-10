import { useEffect, useReducer, useRef } from "react";
import type { ConversationItem } from "../conversation/projector.js";
import type { PiClient } from "./client.js";
import { createPiChatController, type PiChatController, type PiChatControllerOptions } from "./pi-chat-controller.js";

export interface PiChat {
	readonly items: readonly ConversationItem[];
	readonly busy: boolean;
	readonly error: string | undefined;
	readonly hasStarted: boolean;
	sendMessage: (text: string) => void;
}

/**
 * Owns any number of independent, concurrently-live Pi RPC sessions, one per
 * caller-chosen key -- a Workspace id, today -- rather than usePiChat's
 * single app-wide session. Each key's session spawns lazily on its own
 * first sendMessage, exactly like usePiChat, and keeps running independently
 * of every other key's session (and of which one is currently displayed)
 * until this hook's owner unmounts.
 *
 * `chatFor` is a plain function, not a hook -- it must not call
 * useSyncExternalStore or similar per key, since React's rules of hooks
 * forbid calling a hook once per dynamic key. Instead this hook subscribes
 * to every controller it creates and re-renders its owner on any of their
 * changes, so a fresh `getSnapshot()` read inside `chatFor` is always
 * current by the time this component's render runs. The one real cost:
 * a session running in the background (not currently displayed) still
 * triggers its owner's re-render on every event, same as any other -- fine
 * for a single top-level App component today, worth revisiting if that
 * ever shows up as real jank.
 */
export function usePiChatSessions(client: PiClient) {
	const controllers = useRef(new Map<string, PiChatController>());
	const unsubscribes = useRef(new Map<string, () => void>());
	const [, forceRender] = useReducer((n: number) => n + 1, 0);

	useEffect(() => {
		const liveControllers = controllers.current;
		const liveUnsubscribes = unsubscribes.current;
		return () => {
			for (const unsubscribe of liveUnsubscribes.values()) unsubscribe();
			for (const controller of liveControllers.values()) controller.dispose();
			liveUnsubscribes.clear();
			liveControllers.clear();
		};
	}, []);

	function controllerFor(key: string, options?: PiChatControllerOptions): PiChatController {
		let controller = controllers.current.get(key);
		if (!controller) {
			controller = createPiChatController(client, options);
			controllers.current.set(key, controller);
			unsubscribes.current.set(key, controller.subscribe(forceRender));
		}
		return controller;
	}

	return {
		/** A live PiChat view bound to `key`, created (and its session spawned lazily) on first access. `options` only applies the first time a given key is seen -- a session, once created, keeps whatever cwd it started with. */
		chatFor(key: string, options?: PiChatControllerOptions): PiChat {
			const controller = controllerFor(key, options);
			const snapshot = controller.getSnapshot();
			return { ...snapshot, sendMessage: controller.sendMessage };
		},
		/** Ends one key's session early, e.g. when its Workspace is deleted -- distinct from the blanket cleanup on unmount. */
		disposeSession(key: string): void {
			unsubscribes.current.get(key)?.();
			unsubscribes.current.delete(key);
			controllers.current.get(key)?.dispose();
			controllers.current.delete(key);
		},
	};
}
