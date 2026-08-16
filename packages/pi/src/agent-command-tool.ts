import { CommandIntentSchema, parseWithSchema, type IntegrationDefinition, type IntegrationId } from "@zodiac/protocol";
import { authorizeAgentCommand, type AgentIntegrationGrant, type AgentSessionPolicy } from "@zodiac/server/agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * The one tool a Pi agent gets to drive Zodiac with: a flat argument shape
 * covering every CommandIntent variant's own fields, validated for real by
 * CommandIntentSchema itself (the same schema a human dispatch call is
 * validated against) rather than a separate, possibly-drifting hand-written
 * copy. Extra fields a given `type` doesn't use (e.g. `surfaceId` on a
 * `surface.dock` call) are simply ignored by that schema's own per-variant
 * shape.
 */
const AgentCommandArgsSchema = Type.Object({
	type: Type.Union([
		Type.Literal("workspace.create"),
		Type.Literal("surface.dock"),
		Type.Literal("surface.undock"),
		Type.Literal("window.next"),
		Type.Literal("window.previous"),
	]),
	workspaceId: Type.String({ description: "The target Workspace's id." }),
	title: Type.Optional(Type.String({ description: "Required for workspace.create and surface.dock." })),
	integrationId: Type.Optional(Type.String({ description: "Required for surface.dock -- which Integration to dock." })),
	surfaceId: Type.Optional(Type.String({ description: "Required for surface.undock -- which Surface to remove." })),
	windowId: Type.Optional(Type.String({ description: "Optional for surface.dock -- defaults to the active Window." })),
});

export interface CreateAgentCommandToolOptions {
	/** Where the daemon's own /api/world/commands route lives -- the exact endpoint a human UI's RemoteWorldStore posts to, so an authorized tool call and a human dispatch produce identical WorldStore mutations through the identical transport, not just structurally similar ones. */
	readonly daemonUrl: string;
	readonly grant: AgentIntegrationGrant;
	readonly sessionPolicy: AgentSessionPolicy;
	readonly getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined;
	/** Overridable for tests; defaults to the real global fetch. */
	readonly fetcher?: typeof fetch;
}

/**
 * Registers as a real Pi tool (see registerAgentCommandTool below): the LLM
 * supplies a CommandIntent-shaped object, this validates it with the same
 * schema a human dispatch call goes through, authorizes it against this
 * session's own grant (authorizeAgentCommand -- the intersection of session
 * policy, granted Workspace/command types, and the target Integration's own
 * declared hasApi capability), and only then POSTs it to the daemon.
 *
 * A denial or a validation failure throws -- Pi's own agent loop turns a
 * thrown execute() into a real tool_execution_end with isError: true, the
 * signal a caller (or a test) checks for, carrying the denial reason in its
 * own message text.
 */
export function createAgentCommandTool(options: CreateAgentCommandToolOptions): ToolDefinition<typeof AgentCommandArgsSchema> {
	const fetcher = options.fetcher ?? fetch;
	return {
		name: "zodiac_dispatch_command",
		label: "Zodiac Command",
		description:
			"Dispatches one Zodiac CommandIntent (workspace.create, surface.dock, surface.undock, window.next, window.previous) through the same authorized daemon endpoint a human UI action uses. Denied outside this session's own granted Workspace and command types.",
		parameters: AgentCommandArgsSchema,
		async execute(_toolCallId, params) {
			const parsed = parseWithSchema(CommandIntentSchema, params);
			if (!parsed.ok) throw new Error(`Invalid Zodiac command: ${parsed.issues.join("; ")}`);
			const intent = parsed.value;

			const authorization = authorizeAgentCommand(intent, { grant: options.grant, sessionPolicy: options.sessionPolicy, getIntegration: options.getIntegration });
			if (!authorization.ok) throw new Error(`Zodiac command denied (${authorization.reason}): "${intent.type}" is not permitted for this Agent Integration session.`);

			const response = await fetcher(`${options.daemonUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent }),
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { message?: string };
				throw new Error(`Zodiac command rejected by the daemon (${response.status}): ${body.message ?? "unknown error"}`);
			}
			return { content: [{ type: "text", text: `Applied ${intent.type} to Workspace "${intent.workspaceId}".` }], details: { intent } };
		},
	};
}
