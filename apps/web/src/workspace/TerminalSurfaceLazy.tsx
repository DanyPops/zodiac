import { lazy, Suspense } from "react";

// xterm.js + its fit addon are a real, dedicated-purpose dependency (~85kB
// gzip) only a Terminal Surface ever needs -- code-split via lazy(), the
// same technique App.tsx's own WindowDockview import already established,
// so docking Chat/Activity/anything else never pays for it. The dynamic
// import() only fires once this component actually mounts (a Terminal
// Surface is actually docked), not merely once this module loads. Split
// into its own file (not inlined in surface-templates.tsx) for the same
// Fast-Refresh reason ActivitySurface.tsx's own doc comment already
// documents -- a data/registry module must export only data, never a
// component, lazy-wrapped or not.
const LazyTerminalSurfaceContent = lazy(() => import("./TerminalSurface.js").then((module) => ({ default: module.TerminalSurfaceContent })));

export function TerminalSurfaceLazy(): React.JSX.Element {
	return (
		<Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-gray-500 dark:text-gray-400">Loading terminal&hellip;</div>}>
			<LazyTerminalSurfaceContent />
		</Suspense>
	);
}
