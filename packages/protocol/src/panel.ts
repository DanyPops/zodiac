import { z } from "zod";
import { AppletIdSchema, PanelIdSchema } from "./ids.js";
import type { AppletId } from "./ids.js";
import type { ParseResult } from "./result.js";

/** Where a Panel sits -- "floating" is first-class (KDE's Plasma::Types::Location), not a special case bolted onto the 4 edges. */
export const LocationSchema = z.enum(["floating", "top", "bottom", "left", "right"]);
export type Location = z.infer<typeof LocationSchema>;

export const PanelAlignmentSchema = z.enum(["start", "center", "end"]);
export type PanelAlignment = z.infer<typeof PanelAlignmentSchema>;

export const FormFactorSchema = z.enum(["horizontal", "vertical"]);
export type FormFactor = z.infer<typeof FormFactorSchema>;

/** Location minus "floating" -- the 4 real edges a Panel can dock to, shared by regions.ts's own edge-Location geometry and apps/web's chat-placement (a chat Panel is never "floating" today, only ever docked to one of these 4). */
export const EdgeLocationSchema = z.enum(["top", "bottom", "left", "right"]);
export type EdgeLocation = z.infer<typeof EdgeLocationSchema>;

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

/** A micro-application content unit (Chat, Notifications, ...) an owning package registers -- Panel never carries content identity itself. A slot:"cap" Applet's maxInstances is forced to 1: a Cap is a system-owned, exactly-one-instance-ever slot, not a caller-adjustable default. */
export const AppletDefinitionSchema = z
	.object({
		id: AppletIdSchema,
		title: z.string().trim().min(1),
		slot: AppletSlotSchema,
		supportedFormFactors: z.set(FormFactorSchema).min(1),
		maxInstances: z.number().int().positive(),
	})
	.refine((applet) => applet.slot !== "cap" || applet.maxInstances === 1, { message: "A slot:\"cap\" AppletDefinition must have maxInstances 1", path: ["maxInstances"] });
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

/** Rejects assigning a slot:"body" Applet into a cap, or a slot:"cap" Applet into the body -- Panel and AppletDefinition carry no static link to each other, so this is the one place that cross-checks them. An id with no matching AppletDefinition is itself a typed rejection, not silently ignored. */
export function validatePanelAppletAssignment(panel: Panel, appletById: (id: AppletId) => AppletDefinition | undefined): ParseResult<true> {
	const issues: string[] = [];
	for (const [slotName, appletId] of [
		["startCap", panel.startCap],
		["endCap", panel.endCap],
	] as const) {
		if (appletId === null) continue;
		const applet = appletById(appletId);
		if (!applet) issues.push(`${slotName}: no AppletDefinition registered for "${appletId}"`);
		else if (applet.slot !== "cap") issues.push(`${slotName}: Applet "${appletId}" has slot "${applet.slot}", expected "cap"`);
	}
	for (const appletId of panel.body) {
		const applet = appletById(appletId);
		if (!applet) issues.push(`body: no AppletDefinition registered for "${appletId}"`);
		else if (applet.slot !== "body") issues.push(`body: Applet "${appletId}" has slot "${applet.slot}", expected "body"`);
	}
	return issues.length === 0 ? { ok: true, value: true } : { ok: false, issues };
}
