import { Wrench } from "lucide-react";

/** The Activity child surface's content -- split out from chat-surface-registry.tsx so that data/registry module exports only data, never a mix of data and components (required for reliable Fast Refresh). */
export function ActivitySurfaceContent(): React.JSX.Element {
	return (
		<div className="h-full overflow-auto p-6">
			<div className="mx-auto max-w-3xl">
				<h3 className="text-sm font-semibold text-gray-950 dark:text-white">Workspace activity</h3>
				<p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
					This parent-attached child shares Chat context without becoming another root window. Activity data arrives through its own bounded view.
				</p>
				<ActivitySurfaceState />
			</div>
		</div>
	);
}

function ActivitySurfaceState(): React.JSX.Element {
	return (
		<div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
			<p className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-gray-100">
				<Wrench aria-hidden="true" size={12} />
				Surface state
			</p>
			<dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-2 text-xs text-gray-600 dark:text-gray-300">
				<dt>Containment</dt><dd>Chat → Activity</dd>
				<dt>Layout</dt><dd>Parent-attached tab</dd>
				<dt>Freshness</dt><dd>FRESH</dd>
			</dl>
		</div>
	);
}
