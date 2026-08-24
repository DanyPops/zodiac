/**
 * A package's own "zodiac" package.json field: a package declares itself as
 * an Integration without Zodiac's own source tree needing to name it. Three
 * named contribution kinds today: two loadable, in-process ones matching
 * existing hand-wired interfaces -- AppletDefinition (applet-registry.ts)
 * and ZodiacContribution (packages/protocol/src/contributions.ts) -- and
 * one purely declarative one (vehicle-surface) naming an already-running
 * Vehicle daemon to proxy through, with no code to load at all.
 *
 * Resolution and filesystem scanning are out of scope here -- this module
 * only parses a manifest object/file it's handed. See Doc "Design: Zodiac
 * as a platform" for discovery/distribution.
 */
import { readFileSync } from "node:fs";
import { ContributionPointKindSchema, type ContributionPointKind } from "@zodiac/protocol";
import { z } from "zod";

/** Compatibility name for manifests; the authoritative taxonomy lives in @zodiac/protocol. */
export const ZodiacIntegrationKindSchema = ContributionPointKindSchema;
export type ZodiacIntegrationKind = ContributionPointKind;

const MAX_VEHICLE_SURFACE_INVALIDATION_TOPICS = 32;

/**
 * A declarative Vehicle Surface: no `entry` module, since there's no code
 * to load or activate -- just naming data for an already-running Vehicle
 * daemon zodiacd's own VehicleSurfaceGateway proxies through (see
 * contributions.ts's own VEHICLE_SURFACE_CONTRIBUTION_POINT doc comment).
 * `.strict()` so an accidental `entry` field (a copy-paste from a loadable
 * entry) fails loud at manifest-parse time instead of being silently
 * ignored.
 */
export const ZodiacVehicleSurfaceIntegrationEntrySchema = z
	.object({
		kind: z.literal("vehicle-surface"),
		vehicleName: z.string().trim().min(1).max(214),
		title: z.string().trim().min(1).max(200),
		invalidationTopics: z.array(z.string().trim().min(1).max(200)).max(MAX_VEHICLE_SURFACE_INVALIDATION_TOPICS).optional(),
	})
	.strict();
export type ZodiacVehicleSurfaceIntegrationEntry = z.infer<typeof ZodiacVehicleSurfaceIntegrationEntrySchema>;

export const ZodiacIntegrationEntrySchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("applet"), entry: z.string().trim().min(1).max(1_024) }),
	z.object({ kind: z.literal("editor"), entry: z.string().trim().min(1).max(1_024) }),
	ZodiacVehicleSurfaceIntegrationEntrySchema,
]);
export type ZodiacIntegrationEntry = z.infer<typeof ZodiacIntegrationEntrySchema>;

export const ZodiacManifestFieldSchema = z.object({
	integrations: z.array(ZodiacIntegrationEntrySchema).min(1).max(32),
});
export type ZodiacManifestField = z.infer<typeof ZodiacManifestFieldSchema>;

/**
 * Reads a parsed package.json's own "zodiac" field. Returns undefined when
 * absent -- most packages aren't Integrations. Throws when the field is
 * present but malformed: a package that opts in wrong should fail loud at
 * load time, not silently contribute nothing.
 */
export function readZodiacManifest(packageJson: unknown): ZodiacManifestField | undefined {
	if (typeof packageJson !== "object" || packageJson === null) return undefined;
	const raw = (packageJson as Record<string, unknown>).zodiac;
	if (raw === undefined) return undefined;
	return ZodiacManifestFieldSchema.parse(raw);
}

/** Reads and parses a package.json file at `path`, then extracts its "zodiac" field via readZodiacManifest. */
export function readZodiacManifestFile(packageJsonPath: string): ZodiacManifestField | undefined {
	const contents: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	return readZodiacManifest(contents);
}
