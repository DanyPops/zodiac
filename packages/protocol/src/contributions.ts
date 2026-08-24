import { z } from "zod";

export const ContributionCardinalitySchema = z.enum(["exactly-one", "zero-or-one", "zero-or-many"]);
export type ContributionCardinality = z.infer<typeof ContributionCardinalitySchema>;

export const ContributionPointKindSchema = z.enum(["applet", "editor", "vehicle-surface", "vehicle-loopback"]);
export type ContributionPointKind = z.infer<typeof ContributionPointKindSchema>;

export const ContributionPointDefinitionSchema = z.object({
  kind: ContributionPointKindSchema,
  cardinality: ContributionCardinalitySchema,
});
export interface ContributionPointDefinition<TKind extends string = ContributionPointKind> {
  readonly kind: TKind;
  readonly cardinality: ContributionCardinality;
}

export const APPLET_CONTRIBUTION_POINT = { kind: "applet", cardinality: "zero-or-many" } as const satisfies ContributionPointDefinition<"applet">;
export const EDITOR_CONTRIBUTION_POINT = { kind: "editor", cardinality: "exactly-one" } as const satisfies ContributionPointDefinition<"editor">;
/** A declarative Vehicle Surface: no module to load (no `activate(host)` call, no code-loading risk beyond the manifest itself) -- just data naming which already-running Vehicle daemon to proxy through zodiacd's own VehicleSurfaceGateway. Zero-or-many: a package can name more than one Vehicle Surface. */
export const VEHICLE_SURFACE_CONTRIBUTION_POINT = { kind: "vehicle-surface", cardinality: "zero-or-many" } as const satisfies ContributionPointDefinition<"vehicle-surface">;
/**
 * A code-bearing contribution executed out-of-process, over the same
 * authenticated Vehicle loopback transport every Vehicle daemon uses --
 * the real process/trust boundary a plain in-process `editor` contribution
 * does not have. Unlike `vehicle-surface` (an already-running daemon
 * zodiacd only discovers and proxies to), zodiacd itself spawns and owns
 * this contribution's process for the lifetime of its activation. Its
 * commands still register into the same `ContributionHost` an in-process
 * `editor` contribution would, so `integration.invoke`/the HTTP invoke
 * route/tool-grant loading all treat it identically -- the same enforced
 * boundary and dispatch path a hypothetical third-party contribution would
 * use, not a first-party-only shortcut. Zero-or-many: more than one
 * out-of-process contribution can be docked at once, unlike the
 * exactly-one in-process editor point.
 */
export const VEHICLE_LOOPBACK_CONTRIBUTION_POINT = { kind: "vehicle-loopback", cardinality: "zero-or-many" } as const satisfies ContributionPointDefinition<"vehicle-loopback">;

export const ContributionProvenanceSchema = z.object({
  packageId: z.string().trim().min(1).max(214),
  version: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(2_048),
});
export type ContributionProvenance = z.infer<typeof ContributionProvenanceSchema>;

export const ContributionResourceReferenceSchema = z.object({
  uri: z.string().trim().min(1).max(2_048),
  kind: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  readOnly: z.boolean(),
});
export type ContributionResourceReference = z.infer<typeof ContributionResourceReferenceSchema>;

export const ContributionReadBoundsSchema = z.object({
  maxBytes: z.number().int().positive().max(4 * 1024 * 1024),
  maxEntries: z.number().int().positive().max(10_000),
});
export type ContributionReadBounds = z.infer<typeof ContributionReadBoundsSchema>;

export type ContributionOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

export interface ContributionCommand {
  readonly id: string;
  readonly title: string;
  execute(input: unknown): Promise<ContributionOutcome<ContributionResourceReference>>;
}

export interface ContributionResourceProvider {
  readonly scheme: string;
  read(reference: ContributionResourceReference, bounds: ContributionReadBounds): Promise<ContributionOutcome<unknown>>;
}

export interface ContributionHost {
  registerCommand(command: ContributionCommand): () => void;
  registerResourceProvider(provider: ContributionResourceProvider): () => void;
}

/**
 * A capability tag a contribution declares beyond the baseline
 * commands/resourceSchemes describe() already carries -- e.g. an optional
 * protocol feature a future host may or may not understand. Append-only and
 * deliberately unconstrained (plain string, not an enum): the vocabulary
 * doesn't exist yet, this is the extension point Raymond's Rule of
 * Extensibility calls for, not a currently-populated list. A host that
 * doesn't recognize a tag should ignore it, never reject the whole
 * contribution over an unknown one -- forward compatibility, not a strict
 * negotiation handshake.
 */
export type ContributionCapability = string;

export const ContributionCommandDescriptionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
});

export const ContributionDescriptionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  commands: z.array(ContributionCommandDescriptionSchema).max(1_000),
  resourceSchemes: z.array(z.string().trim().min(1).max(100)).max(100),
  version: z.string().trim().min(1).max(100).optional(),
  capabilities: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  contributionPoints: z.array(ContributionPointKindSchema).max(10).optional(),
});

export const ContributionInvokeRequestSchema = z.object({
  commandId: z.string().trim().min(1).max(200),
  input: z.unknown().optional(),
});

export const ContributionResourceReadRequestSchema = z.object({
  resource: ContributionResourceReferenceSchema,
  bounds: ContributionReadBoundsSchema,
});

export interface ContributionDescription {
  readonly id: string;
  readonly title: string;
  readonly commands: readonly { readonly id: string; readonly title: string }[];
  readonly resourceSchemes: readonly string[];
  /**
   * Semver of this contribution's own describe()/ContributionCommand/
   * ContributionResourceProvider shape. Optional so a contribution written
   * before this field existed keeps typechecking unchanged; a consumer that
   * needs real version negotiation should treat an absent version as
   * "unknown", not as "0.0.0" (a genuinely absent version isn't the same
   * claim as an explicit pre-1.0 one).
   */
  readonly version?: string;
  /** Declared capability tags beyond the baseline surface (see ContributionCapability). Optional; absent means "assume baseline only". */
  readonly capabilities?: readonly ContributionCapability[];
  /** Named platform points supplied by this package. Optional for contributions authored before the applet/editor taxonomy existed. */
  readonly contributionPoints?: readonly ContributionPointKind[];
}

export interface ZodiacContribution {
  describe(): ContributionDescription;
  activate(host: ContributionHost): void | Promise<void>;
  dispose(): void | Promise<void>;
}
