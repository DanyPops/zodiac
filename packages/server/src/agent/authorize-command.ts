import type { CommandIntent, IntegrationDefinition, IntegrationId, WorkspaceId } from "@zodiac/protocol";

/**
 * What one Agent Integration session is allowed to do: a single Workspace,
 * plus the CommandIntent types it may issue inside it. One grant per
 * session -- an agent that needs a second Workspace gets a second grant,
 * not a wider one.
 */
export interface AgentIntegrationGrant {
	readonly workspaceId: WorkspaceId;
	readonly allowedCommandTypes: ReadonlySet<CommandIntent["type"]>;
}

/** The caller/session-level switch beneath any grant -- revoked mid-session, expired, or never authenticated. */
export interface AgentSessionPolicy {
	readonly allowed: boolean;
}

export type AgentCommandDenialReason = "session-denied" | "workspace-not-granted" | "command-not-granted" | "integration-lacks-api";

export type AgentCommandAuthorization = { readonly ok: true } | { readonly ok: false; readonly reason: AgentCommandDenialReason };

export interface AuthorizeAgentCommandContext {
	readonly grant: AgentIntegrationGrant;
	readonly sessionPolicy: AgentSessionPolicy;
	readonly getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined;
}

/**
 * The single authorization check every Agent Integration tool call goes
 * through before reaching WorldStore.apply(): the intersection of session
 * policy, the grant's Workspace and command types, and (for a command that
 * names a target Integration) that Integration's own declared hasApi
 * capability. Denies closed on any missing piece rather than assuming
 * consent.
 */
export function authorizeAgentCommand(intent: CommandIntent, context: AuthorizeAgentCommandContext): AgentCommandAuthorization {
	if (!context.sessionPolicy.allowed) return { ok: false, reason: "session-denied" };
	// panel.move carries no workspaceId -- a Panel is global World chrome, not owned by any one Workspace, so there is nothing to check a grant's own workspaceId against.
	if ("workspaceId" in intent && intent.workspaceId !== context.grant.workspaceId) return { ok: false, reason: "workspace-not-granted" };
	if (!context.grant.allowedCommandTypes.has(intent.type)) return { ok: false, reason: "command-not-granted" };
	if (intent.type === "surface.dock") {
		const integration = context.getIntegration(intent.integrationId);
		if (!integration || !integration.capabilities.hasApi) return { ok: false, reason: "integration-lacks-api" };
	}
	return { ok: true };
}
