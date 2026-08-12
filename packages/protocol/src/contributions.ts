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

export interface ContributionDescription {
  readonly id: string;
  readonly title: string;
  readonly commands: readonly { readonly id: string; readonly title: string }[];
  readonly resourceSchemes: readonly string[];
}

export interface AlignmentContribution {
  describe(): ContributionDescription;
  activate(host: ContributionHost): void | Promise<void>;
  dispose(): void | Promise<void>;
}
