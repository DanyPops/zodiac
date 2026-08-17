import { z } from "zod";

// Also published as "@zodiac/protocol/ids" (see package.json) for a caller
// that needs id-branding in a bundle too budget-constrained for the full
// barrel's zod schema weight -- see apps/web's surface-templates.tsx.

/**
 * A nominal wrapper around a primitive so two same-shaped-but-distinct
 * identifiers (a WorkspaceId and a WindowId are both plain strings) can
 * never be passed to each other's parameter without a compile error.
 */
export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

/**
 * One non-empty-string branded id: the schema is the single runtime
 * boundary that can produce the branded type -- both the throwing
 * constructor below and any external/persisted-payload parse path
 * (surfaceIdSchema.safeParse, WorldSchema, ...) go through it, so there is
 * never a second, divergent validation rule for the same id kind.
 */
function brandedIdSchema<TBrand extends string>(brand: TBrand) {
	return z
		.string()
		.trim()
		.min(1, `${brand} must be a non-empty string`)
		.transform((value) => value as Brand<string, TBrand>);
}

export const WorldIdSchema = brandedIdSchema("WorldId");
export type WorldId = z.infer<typeof WorldIdSchema>;
/** Throws on an empty/blank literal -- a hardcoded bad id is a programmer error, not an expected runtime condition. Untrusted input goes through WorldIdSchema.safeParse instead. */
export function worldId(value: string): WorldId {
	return WorldIdSchema.parse(value);
}

export const WorkspaceIdSchema = brandedIdSchema("WorkspaceId");
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;
export function workspaceId(value: string): WorkspaceId {
	return WorkspaceIdSchema.parse(value);
}

export const WindowIdSchema = brandedIdSchema("WindowId");
export type WindowId = z.infer<typeof WindowIdSchema>;
export function windowId(value: string): WindowId {
	return WindowIdSchema.parse(value);
}

export const SurfaceIdSchema = brandedIdSchema("SurfaceId");
export type SurfaceId = z.infer<typeof SurfaceIdSchema>;
export function surfaceId(value: string): SurfaceId {
	return SurfaceIdSchema.parse(value);
}

export const IntegrationIdSchema = brandedIdSchema("IntegrationId");
export type IntegrationId = z.infer<typeof IntegrationIdSchema>;
export function integrationId(value: string): IntegrationId {
	return IntegrationIdSchema.parse(value);
}

export const CommandIdSchema = brandedIdSchema("CommandId");
export type CommandId = z.infer<typeof CommandIdSchema>;
export function commandId(value: string): CommandId {
	return CommandIdSchema.parse(value);
}

export const ResourceIdSchema = brandedIdSchema("ResourceId");
export type ResourceId = z.infer<typeof ResourceIdSchema>;
export function resourceId(value: string): ResourceId {
	return ResourceIdSchema.parse(value);
}

export const PanelIdSchema = brandedIdSchema("PanelId");
export type PanelId = z.infer<typeof PanelIdSchema>;
export function panelId(value: string): PanelId {
	return PanelIdSchema.parse(value);
}

export const AppletIdSchema = brandedIdSchema("AppletId");
export type AppletId = z.infer<typeof AppletIdSchema>;
export function appletId(value: string): AppletId {
	return AppletIdSchema.parse(value);
}
