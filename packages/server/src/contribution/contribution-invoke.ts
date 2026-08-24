import type { ContributionCommand, ContributionDescription, ContributionOutcome } from "@zodiac/protocol";

export interface ContributionInvokeRegistry {
	readonly descriptions: ReadonlyMap<string, ContributionDescription>;
	readonly commands: ReadonlyMap<string, ContributionCommand>;
}

/**
 * Looks up and executes one contribution's own command by id, producing the
 * exact typed outcome shape both `/api/contributions/:id/invoke` (a direct
 * client call) and `integration.invoke` (an agent-authorized CommandIntent)
 * report back through -- the same lookup/error-code logic either caller
 * would otherwise have to duplicate.
 */
export async function invokeContributionCommand(contributionId: string, action: string, input: unknown, registry: ContributionInvokeRegistry): Promise<ContributionOutcome<unknown>> {
	const description = registry.descriptions.get(contributionId);
	if (!description) return { ok: false, code: "contribution-not-found", message: `No contribution registered for "${contributionId}"` };
	if (!description.commands.some((command) => command.id === action)) return { ok: false, code: "command-not-found", message: `Contribution "${contributionId}" has no command "${action}"` };
	const command = registry.commands.get(action);
	if (!command) return { ok: false, code: "command-unavailable", message: `Command "${action}" is not currently registered` };
	try {
		return await command.execute(input);
	} catch (error) {
		return { ok: false, code: "contribution-error", message: error instanceof Error ? error.message : "Contribution command failed" };
	}
}
