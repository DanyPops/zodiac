import { z } from "zod";
import { AppletIdSchema, PanelIdSchema } from "./ids.js";

/** Where a Panel sits -- "floating" is first-class (KDE's Plasma::Types::Location), not a special case bolted onto the 4 edges. */
export const LocationSchema = z.enum(["floating", "top", "bottom", "left", "right"]);
export type Location = z.infer<typeof LocationSchema>;

export const PanelAlignmentSchema = z.enum(["start", "center", "end"]);
export type PanelAlignment = z.infer<typeof PanelAlignmentSchema>;

export const FormFactorSchema = z.enum(["horizontal", "vertical"]);
export type FormFactor = z.infer<typeof FormFactorSchema>;

/** top/bottom panels are wide strips, left/right are tall strips; floating has no edge to take its shape from, so it defaults to horizontal -- the more common toolbar/strip shape. */
export function formFactorForLocation(location: Location): FormFactor {
	return location === "left" || location === "right" ? "vertical" : "horizontal";
}

export const LengthModeSchema = z.enum(["fill", "fit-content", "custom"]);
export type LengthMode = z.infer<typeof LengthModeSchema>;

export const VisibilityModeSchema = z.enum(["normal", "auto-hide", "dodge-windows"]);
export type VisibilityMode = z.infer<typeof VisibilityModeSchema>;

export const AppletSlotSchema = z.enum(["cap", "body"]);
export type AppletSlot = z.infer<typeof AppletSlotSchema>;

/** A micro-application content unit (Chat, Notifications, ...) an owning package registers -- Panel never carries content identity itself. */
export const AppletDefinitionSchema = z.object({
	id: AppletIdSchema,
	title: z.string().trim().min(1),
	slot: AppletSlotSchema,
	supportedFormFactors: z.set(FormFactorSchema).min(1),
	maxInstances: z.number().int().positive(),
});
export type AppletDefinition = z.infer<typeof AppletDefinitionSchema>;

/** Pure placement/container: one Panel per Location, Cap-Body-Cap anatomy (two system-owned Caps, an ordered Body of flexible Applets). */
export const PanelSchema = z.object({
	id: PanelIdSchema,
	location: LocationSchema,
	alignment: PanelAlignmentSchema,
	offset: z.number().int().nonnegative(),
	thickness: z.number().int().positive(),
	lengthMode: LengthModeSchema,
	length: z.number().int().positive().optional(),
	visibilityMode: VisibilityModeSchema,
	startCap: AppletIdSchema.nullable(),
	endCap: AppletIdSchema.nullable(),
	body: z.array(AppletIdSchema).max(64),
});
export type Panel = z.infer<typeof PanelSchema>;
