import { z } from "zod";
import { SurfaceIdSchema, SurfaceTemplateIdSchema, WindowIdSchema, WorkspaceIdSchema } from "./ids.js";

/**
 * A typed interaction intent -- what a keybinding, a control, a palette
 * entry, a script/RPC call, and an agent action all ultimately produce, so
 * the same core dispatcher handles every path identically. New variants
 * must extend this union; every consumer that switches on `type` is
 * expected to do so exhaustively (see world/store.ts's `apply`).
 */
export const CommandIntentSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("workspace.create"), workspaceId: WorkspaceIdSchema, title: z.string().trim().min(1) }),
	z.object({ type: z.literal("surface.dock"), workspaceId: WorkspaceIdSchema, templateId: SurfaceTemplateIdSchema, title: z.string().trim().min(1), windowId: WindowIdSchema.optional() }),
	z.object({ type: z.literal("surface.undock"), workspaceId: WorkspaceIdSchema, surfaceId: SurfaceIdSchema }),
	z.object({ type: z.literal("window.next"), workspaceId: WorkspaceIdSchema }),
	z.object({ type: z.literal("window.previous"), workspaceId: WorkspaceIdSchema }),
]);

export type CommandIntent = z.infer<typeof CommandIntentSchema>;
