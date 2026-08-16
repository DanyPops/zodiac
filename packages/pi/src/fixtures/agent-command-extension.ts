import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { workspaceId, type CommandIntent, type IntegrationDefinition } from "@zodiac/protocol";
import { createAgentCommandTool } from "../agent-command-tool.js";

/**
 * Test-only wiring shim: registers the real zodiac_dispatch_command tool
 * (agent-command-tool.ts) into a real, separately-spawned `pi` process, per
 * @danypops/pi-process-harness's own "--extension <path>" convention.
 * Configuration a real test cannot pass as a JS closure (this file runs in
 * a different OS process) arrives as JSON-encoded env vars instead -- see
 * agent-command-tool.process.test.ts for the exact contract.
 */
export default function (pi: ExtensionAPI): void {
	const daemonUrl = process.env["ZODIAC_AGENT_TOOL_DAEMON_URL"];
	if (!daemonUrl) throw new Error("ZODIAC_AGENT_TOOL_DAEMON_URL is required");

	const grantRaw = JSON.parse(process.env["ZODIAC_AGENT_TOOL_GRANT"] ?? "{}") as { workspaceId: string; allowedCommandTypes: readonly CommandIntent["type"][] };
	const integrationsRaw = JSON.parse(process.env["ZODIAC_AGENT_TOOL_INTEGRATIONS"] ?? "[]") as readonly IntegrationDefinition[];
	const sessionAllowed = process.env["ZODIAC_AGENT_TOOL_SESSION_ALLOWED"] !== "false";

	const tool = createAgentCommandTool({
		daemonUrl,
		grant: { workspaceId: workspaceId(grantRaw.workspaceId), allowedCommandTypes: new Set(grantRaw.allowedCommandTypes) },
		sessionPolicy: { allowed: sessionAllowed },
		getIntegration: (id) => integrationsRaw.find((definition) => definition.id === id),
	});
	pi.registerTool(tool);
}
