import type { ContributionHost, ContributionProvenance, ZodiacContribution } from "@zodiac/protocol";

export interface EditorContributionRegistration {
	readonly id: string;
	readonly contribution: ZodiacContribution;
}

export interface ActiveContribution {
	readonly id: string;
	readonly provenance: ContributionProvenance;
	dispose(): Promise<void>;
}

export interface ExecutionStrategy {
	activate(contribution: ZodiacContribution, provenance: ContributionProvenance): Promise<ActiveContribution>;
}

interface EditorPointRegistry {
	register(kind: "editor", value: EditorContributionRegistration, provenance: ContributionProvenance): () => void;
}

/**
 * Executes trusted package code directly in the current process. The strategy
 * owns activation rollback and disposal ordering; callers do not need to know
 * whether a future strategy runs the same contribution in another process.
 */
export function createInProcessExecutionStrategy(
	registry: EditorPointRegistry,
	host: ContributionHost,
): ExecutionStrategy {
	return {
		async activate(contribution, provenance) {
			const description = contribution.describe();
			if (description.contributionPoints && !description.contributionPoints.includes("editor")) {
				throw new Error(`Contribution "${description.id}" does not declare the editor point`);
			}
			const unregister = registry.register("editor", { id: description.id, contribution }, provenance);
			try {
				await contribution.activate(host);
			} catch (error) {
				try {
					await contribution.dispose();
				} catch {
					// Preserve the activation failure; disposal is best-effort rollback here.
				}
				unregister();
				throw error;
			}
			let active = true;
			return {
				id: description.id,
				provenance,
				async dispose() {
					if (!active) return;
					active = false;
					try {
						await contribution.dispose();
					} finally {
						unregister();
					}
				},
			};
		},
	};
}
