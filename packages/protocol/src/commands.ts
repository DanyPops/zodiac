import { z } from "zod";
import { CommandIdSchema, IntegrationIdSchema, SurfaceIdSchema, WindowIdSchema, WorkspaceIdSchema } from "./ids.js";

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
	z.object({ type: z.literal("surface.dock"), workspaceId: WorkspaceIdSchema, integrationId: IntegrationIdSchema, title: z.string().trim().min(1), windowId: WindowIdSchema.optional(), ...commandIdField }),
	z.object({ type: z.literal("surface.undock"), workspaceId: WorkspaceIdSchema, surfaceId: SurfaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.next"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
	z.object({ type: z.literal("window.previous"), workspaceId: WorkspaceIdSchema, ...commandIdField }),
]);

export type CommandIntent = z.infer<typeof CommandIntentSchema>;
