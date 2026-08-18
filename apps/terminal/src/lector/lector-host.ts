import { createLectorZodiacContribution, type LectorOperations } from "@danypops/zodiac-lector";
import type {
	ZodiacContribution,
	ContributionCommand,
	ContributionOutcome,
	ContributionReadBounds,
	ContributionResourceProvider,
	ContributionResourceReference,
} from "@zodiac/protocol";

/**
 * Zodiac's own real ContributionHost for `@danypops/zodiac-lector` -- the one production
 * seam every IDE-PoC slice (workspace, editor, semantic navigation, call graph, Git) calls
 * through. A test's own inline `host()` helper (see the Lector package's own contract tests) is
 * this exact shape; this is that same object made real and reusable, not a parallel design.
 */
export interface LectorHost {
	activate(): Promise<void>;
	dispose(): Promise<void>;
	execute(commandId: string, input: unknown): Promise<ContributionOutcome<ContributionResourceReference>>;
	read(resource: ContributionResourceReference, bounds: ContributionReadBounds): Promise<ContributionOutcome<unknown>>;
}

export function createLectorHost(options: { operations?: LectorOperations; contribution?: ZodiacContribution } = {}): LectorHost {
	const contribution = options.contribution ?? createLectorZodiacContribution({ operations: options.operations });
	const commands = new Map<string, ContributionCommand>();
	let provider: ContributionResourceProvider | undefined;
	let active = false;

	return {
		async activate() {
			if (active) throw new Error("Lector host is already active");
			await contribution.activate({
				registerCommand(command) {
					commands.set(command.id, command);
					return () => commands.delete(command.id);
				},
				registerResourceProvider(value) {
					provider = value;
					return () => {
						provider = undefined;
					};
				},
			});
			active = true;
		},
		async dispose() {
			await contribution.dispose();
			commands.clear();
			provider = undefined;
			active = false;
		},
		async execute(commandId, input) {
			const command = commands.get(commandId);
			if (!command) return { ok: false, code: "unknown-command", message: `Lector host has no command "${commandId}"` };
			return command.execute(input);
		},
		async read(resource, bounds) {
			if (!provider) return { ok: false, code: "no-provider", message: "Lector host's resource provider is not registered" };
			return provider.read(resource, bounds);
		},
	};
}
