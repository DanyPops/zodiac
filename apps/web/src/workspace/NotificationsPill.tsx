import * as Popover from "@radix-ui/react-popover";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { Bell } from "lucide-react";
import { cn } from "../platform/cn.js";
import { iconButtonClassName, pillClassName, SURFACE_BG } from "@zodiac/ui";

/**
 * Notifications flanking the Window Carousel -- reuses the shared pill
 * shape (pillClassName, @zodiac/ui) and Icon Button (iconButtonClassName),
 * the same elements every other pill and action in the shell already
 * uses. A plain local toggle (Radix Popover's own uncontrolled open
 * state), not a global command -- ephemeral peek UI that isn't a
 * Workspace/Window-level action doesn't need one.
 *
 * Pure presentational component -- `pending`/`onApprove`/`onDeny` are props,
 * not a subscription this component owns itself: apps/web is a real HTTP+SSE
 * client of zodiacd (per this repo's own README), so the actual pending-list
 * source of truth (@zodiac/server's ApprovalCenter, Node-only per its own
 * "./approval" subpath -- never importable here, see index.ts's own doc
 * comment) lives daemon-side; a parent wires this component to that daemon
 * state once the live SSE/HTTP surface for it exists. Only `import type`
 * from @danypops/vehicle-core is used here (erased before bundling, adds
 * zero runtime weight) -- never the ApprovalCenter/HmacApprovalAuthority
 * runtime module itself.
 *
 * `title`/raw input aren't shown -- VehicleApprovalRequest only ever carries
 * inputHash over the wire (vehicle-server's own "never leak internals"
 * discipline), not the original input. A human-meaningful summary (e.g.
 * "wants to create issue 'Fix login bug'") needs Zodiac's own correlation of
 * requestId back to the CommandIntent that triggered it, which needs the
 * integration.invoke CommandIntent variant landing first -- see task
 * 263ee9c4's own scope note.
 */
export interface NotificationsPillProps {
	readonly pending?: readonly VehicleApprovalRequest[];
	readonly onApprove?: (requestId: string) => void;
	readonly onDeny?: (requestId: string) => void;
}

export function NotificationsPill({ pending = [], onApprove, onDeny }: NotificationsPillProps): React.JSX.Element {
	return (
		<div className={pillClassName()}>
			<Popover.Root>
				<Popover.Trigger asChild>
					<button type="button" aria-label="Notifications" className={cn(iconButtonClassName({ size: "md" }), "relative")}>
						<Bell aria-hidden="true" size={15} />
						{pending.length > 0 && (
							<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
								{pending.length}
							</span>
						)}
					</button>
				</Popover.Trigger>
				<Popover.Portal>
					<Popover.Content
						align="start"
						sideOffset={8}
						className={cn("z-50 w-72 overflow-hidden rounded-[var(--app-corner-radius,16px)] border border-gray-200 p-3 shadow-2xl outline-none dark:border-gray-700", SURFACE_BG)}
					>
						<p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Notifications</p>
						{pending.length === 0 ? (
							<p className="mt-2 text-sm text-gray-600 dark:text-gray-300">No notifications yet.</p>
						) : (
							<ul className="mt-2 flex flex-col gap-2">
								{pending.map((request) => (
									<li key={request.requestId} className="rounded-[calc(var(--app-corner-radius,16px)-6px)] border border-gray-200 p-2 dark:border-gray-700">
										<p className="text-sm text-gray-700 dark:text-gray-200">
											Approval requested: <span className="font-medium">{request.operationName}</span> ({request.effect})
										</p>
										<div className="mt-2 flex gap-2">
											<button
												type="button"
												onClick={() => onApprove?.(request.requestId)}
												className="rounded-[calc(var(--app-corner-radius,16px)-8px)] bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
											>
												Approve
											</button>
											<button
												type="button"
												onClick={() => onDeny?.(request.requestId)}
												className="rounded-[calc(var(--app-corner-radius,16px)-8px)] bg-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
											>
												Deny
											</button>
										</div>
									</li>
								))}
							</ul>
						)}
					</Popover.Content>
				</Popover.Portal>
			</Popover.Root>
		</div>
	);
}
