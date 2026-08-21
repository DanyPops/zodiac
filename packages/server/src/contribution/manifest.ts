/**
 * A package's own "zodiac" package.json field: a package declares itself as
 * an Integration without Zodiac's own source tree needing to name it. Two
 * named contribution kinds today, matching the two that already exist as
 * separate, hand-wired interfaces -- AppletDefinition (applet-registry.ts)
 * and ZodiacContribution (packages/protocol/src/contributions.ts).
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

/** One contribution point a package activates. `entry` is a module path relative to the package root, resolved by the caller -- this module never touches the filesystem beyond reading the manifest itself. */
export const ZodiacIntegrationEntrySchema = z.object({
	kind: ZodiacIntegrationKindSchema,
	entry: z.string().trim().min(1).max(1_024),
});
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
