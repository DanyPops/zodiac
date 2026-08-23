import { createContext, useContext, type ReactNode } from "react";
import type { RuntimeClientBundle } from "./runtime-client-bundle.js";

/**
 * The "explicit application provider" this codebase's own module-level
 * client singletons (App.tsx's `conversationClient`/`piClient`,
 * TerminalSurface.tsx's `defaultTerminalClient`) are being replaced with.
 * A zero-arg surface-template factory (surface-templates.tsx's `render()`)
 * has no per-render prop-injection path from App.tsx -- context is the one
 * mechanism that reaches a component mounted that way without threading a
 * bundle prop through every intermediate layer.
 */
const RuntimeClientBundleContext = createContext<RuntimeClientBundle | undefined>(undefined);

export function RuntimeClientBundleProvider({ bundle, children }: { readonly bundle: RuntimeClientBundle; readonly children: ReactNode }): React.JSX.Element {
	return <RuntimeClientBundleContext.Provider value={bundle}>{children}</RuntimeClientBundleContext.Provider>;
}

/**
 * Reads the bundle every real render provides. Throwing when it's missing
 * is a genuine programmer error (a component rendered outside
 * `RuntimeClientBundleProvider`), not a recoverable runtime outcome -- the
 * same distinction this codebase's own TypeScript conventions already draw
 * between typed failures and exceptional conditions a caller can't
 * reasonably branch on.
 */
export function useRuntimeClientBundle(): RuntimeClientBundle {
	const bundle = useContext(RuntimeClientBundleContext);
	if (!bundle) throw new Error("useRuntimeClientBundle() called outside RuntimeClientBundleProvider");
	return bundle;
}

/**
 * Non-throwing form for a component that also accepts its own explicit
 * client override prop (e.g. `TerminalSurfaceContent`'s `client`) -- a test
 * supplying that override directly has no need to also wrap itself in
 * `RuntimeClientBundleProvider`, and the Rules of Hooks mean the context
 * read itself can't be skipped conditionally even when the override makes
 * its result unused.
 */
export function useOptionalRuntimeClientBundle(): RuntimeClientBundle | undefined {
	return useContext(RuntimeClientBundleContext);
}
