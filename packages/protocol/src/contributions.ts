import { z } from "zod";

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
}

export interface ZodiacContribution {
  describe(): ContributionDescription;
  activate(host: ContributionHost): void | Promise<void>;
  dispose(): void | Promise<void>;
}
