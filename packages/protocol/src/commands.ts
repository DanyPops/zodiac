import { z } from "zod";
import { CommandIdSchema, IntegrationIdSchema, PanelIdSchema, SurfaceIdSchema, WindowIdSchema, WorkspaceIdSchema } from "./ids.js";
import { LocationSchema, PanelAlignmentSchema } from "./panel.js";

/**
 * Every CommandIntent variant may optionally carry a caller-supplied
 * CommandId (packages/protocol/src/ids.ts) -- purely a correlation token:
 * postCommand echoes it back unchanged alongside whatever the command
 * produced, so a caller dispatching concurrently with other clients (a
 * human and an agent, two browser tabs, ...) can tell its own command's
 * response apart from another caller's. Optional so every existing caller
 * (TUI keybindings, story 7's agent tool) keeps working unchanged.
 */
const commandIdField = { commandId: CommandIdSchema.optional() };

/**
 * A typed interaction intent -- what a keybinding, a control, a palette
 * entry, a script/RPC call, and an agent action all ultimately produce, so
 * the same core dispatcher handles every path identically. New variants
 * must extend this union; every consumer that switches on `type` is
 * expected to do so exhaustively (see world/store.ts's `apply`).
 */
export const CommandIntentSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("workspace.create"), workspaceId: WorkspaceIdSchema, title: z.string().trim().min(1), ...commandIdField }),
	z.object({ type: z.literal("workspace.rename"), workspaceId: WorkspaceIdSchema, title: z.string().trim().min(1), ...commandIdField }),
	z.object({ type: z.literal("workspace.remove"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("workspace.select"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("surface.dock"), workspaceId: WorkspaceIdSchema, integrationId: IntegrationIdSchema, title: z.string().trim().min(1), windowId: WindowIdSchema.optional(), surfaceId: SurfaceIdSchema.optional(), ...commandIdField }),
	z.object({ type: z.literal("surface.undock"), workspaceId: WorkspaceIdSchema, surfaceId: SurfaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.next"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.previous"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.select"), workspaceId: WorkspaceIdSchema, windowId: WindowIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.add"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	/**
	 * Deliberately a plain +/-1 active-Window move -- the *same* wrap-around
	 * ring as window.next/window.previous, not model.ts's own scrollWindow
	 * (which creates an ephemeral Window at either end and prunes an empty
	 * one scrolled away from). Porting that full behavior requires an
	 * `ephemeral` concept the real domain Workspace/WorkspaceWindow entities
	 * don't have yet -- a real, separate, explicitly filed follow-on
	 * ("Port scrollWindow's ephemeral-Window creation/pruning to the daemon
	 * domain model"), not silently absorbed into this variant. Until that
	 * lands, the Window Carousel's own scroll-past-the-end auto-create UX is
	 * a known, disclosed regression versus today's local mock model.
	 */
	z.object({ type: z.literal("window.scroll"), workspaceId: WorkspaceIdSchema, direction: z.union([z.literal(1), z.literal(-1)]), ...commandIdField }),
	z.object({ type: z.literal("window.rename"), workspaceId: WorkspaceIdSchema, windowId: WindowIdSchema, title: z.string().trim().min(1), ...commandIdField }),
	// No workspaceId -- a Panel is global World chrome, not owned by any one Workspace (mirrors today's header/pillar/footer regions, which are also global).
	z.object({ type: z.literal("panel.move"), panelId: PanelIdSchema, placement: z.object({ location: LocationSchema, alignment: PanelAlignmentSchema, offset: z.number().int().nonnegative() }), ...commandIdField }),
	/**
	 * A separate variant from panel.move rather than an overload -- matches
	 * this union's own one-intent-per-verb convention (move vs. resize are
	 * different real actions, e.g. a drag-resize never changes location).
	 * `thickness` is carried in whatever unit the target Panel's own
	 * thicknessUnit already declares -- see PanelThicknessUnit's own doc
	 * comment (panel.ts): a caller resizing a Panel it doesn't own the unit
	 * space for (the TUI dispatching against a "px" Panel, or vice versa) is
	 * a caller bug this schema doesn't police, the same way panel.move
	 * doesn't police FormFactor here either (that's WorldStore.apply's own job).
	 */
	z.object({ type: z.literal("panel.resize"), panelId: PanelIdSchema, thickness: z.number().int().positive(), ...commandIdField }),
	/**
	 * The generic, opaque-payload escape hatch for an external Integration
	 * (a Vehicle) to contribute a new command without a packages/protocol
	 * release -- MCP's "Composability over specificity" applied to this
	 * union: don't grow this schema per external capability, add one variant
	 * whose own action vocabulary is owned and versioned by the target
	 * Integration, not by this package. `action`/`input` are deliberately
	 * `unknown` to this schema -- validated by the target Integration itself
	 * (see world/store.ts's IntegrationInvokeHandler), consistent with
	 * ContributionOutcome<T>'s own fail-loud-not-silent result shape. The
	 * dispatcher's job is routing to the Integration by `integrationId`, not
	 * interpreting `action`/`input` -- see world/store.ts's `apply`.
	 */
	/**
	 * `approvalCapability` (optional, additive -- no COMMAND_INTENT_MIN_VERSION
	 * bump needed, mirrors commandId's own precedent) mirrors Vehicle's own
	 * `enforceGate`'s `presentedCapability` parameter: a capability minted by
	 * approving a prior VehicleApprovalRequest for this exact operation+input,
	 * presented alongside a re-submitted intent -- never merged into `input`
	 * itself, which stays the target Integration's own business payload. See
	 * world/store.ts's IntegrationInvokeHandler context parameter.
	 */
	z.object({ type: z.literal("integration.invoke"), workspaceId: WorkspaceIdSchema, integrationId: IntegrationIdSchema, action: z.string().trim().min(1), input: z.unknown().optional(), approvalCapability: z.string().optional(), ...commandIdField }),
]);

export type CommandIntent = z.infer<typeof CommandIntentSchema>;

/**
 * The protocol's own overall version for CommandIntentSchema. Bumped only
 * when a new variant is added or an existing variant's required fields
 * change in a way an older dispatcher couldn't safely ignore. This union is
 * append-only: an existing variant's own recorded COMMAND_INTENT_MIN_VERSION
 * entry never changes after release (Raymond's Rule of Extensibility --
 * self-describing, versioned, so a future out-of-tree dispatcher speaking an
 * older protocol version can reject/degrade an intent it doesn't understand
 * instead of silently misinterpreting it).
 */
export const COMMAND_INTENT_PROTOCOL_VERSION = 4;

/**
 * The minimum COMMAND_INTENT_PROTOCOL_VERSION a dispatcher must declare
 * support for to safely handle each CommandIntent variant. Every variant
 * shipped before `integration.invoke` was introduced at version 1;
 * `integration.invoke` is the first variant added after this versioning
 * scheme existed, so it records 2. A future variant records whatever
 * COMMAND_INTENT_PROTOCOL_VERSION it ships at, never editing an existing
 * entry.
 */
export const COMMAND_INTENT_MIN_VERSION: Readonly<Record<CommandIntent["type"], number>> = {
	"workspace.create": 1,
	"surface.dock": 1,
	"surface.undock": 1,
	"window.next": 1,
	"window.previous": 1,
	"panel.move": 1,
	"integration.invoke": 2,
	"panel.resize": 3,
	"workspace.rename": 4,
	"workspace.remove": 4,
	"workspace.select": 4,
	"window.select": 4,
	"window.add": 4,
	"window.scroll": 4,
	"window.rename": 4,
};

/**
 * True when a dispatcher that declares support up to `supportedVersion` can
 * safely handle the given intent. False means "reject or degrade this
 * intent, don't dispatch it into undefined behavior" (Raymond's Rule of
 * Repair -- fail loud on an unsupported shape rather than guess). The
 * in-tree dispatcher (world-routes.ts) always ships in lockstep with this
 * schema today, so this is a no-op there; it exists for a future
 * out-of-tree dispatcher (a Vehicle-backed process boundary, see task
 * "Contributions: move from in-process trust to a real process/trust
 * boundary") that may run an older protocol version than the intent's own
 * producer.
 */
export function isSupportedCommandIntent(intent: CommandIntent, supportedVersion: number): boolean {
	return COMMAND_INTENT_MIN_VERSION[intent.type] <= supportedVersion;
}
