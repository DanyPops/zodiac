import { integrationId, panelId, workspaceId, type CommandIntent, type IntegrationDefinition } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { authorizeAgentCommand, type AgentIntegrationGrant } from "./authorize-command.js";

const WORKSPACE = workspaceId("ws-1");
const OTHER_WORKSPACE = workspaceId("ws-2");
const ACTIVITY = integrationId("activity");
const TERMINAL = integrationId("terminal");

function grant(overrides: Partial<AgentIntegrationGrant> = {}): AgentIntegrationGrant {
	return { workspaceId: WORKSPACE, allowedCommandTypes: new Set(["surface.dock", "surface.undock"]), ...overrides };
}

function integrations(...defs: readonly IntegrationDefinition[]): (id: ReturnType<typeof integrationId>) => IntegrationDefinition | undefined {
	return (id) => defs.find((definition) => definition.id === id);
}

function context(overrides: Partial<Parameters<typeof authorizeAgentCommand>[1]> = {}) {
	return {
		grant: grant(),
		sessionPolicy: { allowed: true },
		getIntegration: integrations({ id: ACTIVITY, title: "Activity", capabilities: { renderable: true, hasApi: true } }),
		...overrides,
	};
}

const DOCK_ACTIVITY: CommandIntent = { type: "surface.dock", workspaceId: WORKSPACE, integrationId: ACTIVITY, title: "Activity" };

describe("authorizeAgentCommand", () => {
	it("allows a command that is in the grant's Workspace, in its allowed command types, and whose target Integration exposes an API", () => {
		expect(authorizeAgentCommand(DOCK_ACTIVITY, context())).toEqual({ ok: true });
	});

	it("denies a command targeting a Workspace outside the grant", () => {
		const outcome = authorizeAgentCommand({ ...DOCK_ACTIVITY, workspaceId: OTHER_WORKSPACE }, context());
		expect(outcome).toEqual({ ok: false, reason: "workspace-not-granted" });
	});

	it("denies a command type the grant never listed", () => {
		const outcome = authorizeAgentCommand({ type: "workspace.create", workspaceId: WORKSPACE, title: "New" }, context());
		expect(outcome).toEqual({ ok: false, reason: "command-not-granted" });
	});

	it("denies docking into an Integration that does not declare hasApi, even if the Workspace and command type are granted", () => {
		const outcome = authorizeAgentCommand(
			{ type: "surface.dock", workspaceId: WORKSPACE, integrationId: TERMINAL, title: "Terminal" },
			context({ grant: grant({ allowedCommandTypes: new Set(["surface.dock"]) }), getIntegration: integrations({ id: TERMINAL, title: "Terminal", capabilities: { renderable: true, hasApi: false } }) }),
		);
		expect(outcome).toEqual({ ok: false, reason: "integration-lacks-api" });
	});

	it("denies docking into an Integration the caller has never even registered", () => {
		const outcome = authorizeAgentCommand(DOCK_ACTIVITY, context({ getIntegration: () => undefined }));
		expect(outcome).toEqual({ ok: false, reason: "integration-lacks-api" });
	});

	it("denies every command when session policy itself has revoked the caller, before checking anything else", () => {
		const outcome = authorizeAgentCommand({ type: "workspace.create", workspaceId: OTHER_WORKSPACE, title: "New" }, context({ sessionPolicy: { allowed: false } }));
		expect(outcome).toEqual({ ok: false, reason: "session-denied" });
	});

	it("allows a granted command type that carries no target Integration at all (window navigation)", () => {
		const outcome = authorizeAgentCommand({ type: "window.next", workspaceId: WORKSPACE }, context({ grant: grant({ allowedCommandTypes: new Set(["window.next"]) }) }));
		expect(outcome).toEqual({ ok: true });
	});

	it("allows panel.move once granted, even though it carries no workspaceId to check against the grant's own Workspace", () => {
		const intent: CommandIntent = { type: "panel.move", panelId: panelId("footer"), placement: { location: "bottom", alignment: "start", offset: 0 } };
		const outcome = authorizeAgentCommand(intent, context({ grant: grant({ allowedCommandTypes: new Set(["panel.move"]) }) }));
		expect(outcome).toEqual({ ok: true });
	});

	it("denies panel.move when the grant never listed it", () => {
		const intent: CommandIntent = { type: "panel.move", panelId: panelId("footer"), placement: { location: "bottom", alignment: "start", offset: 0 } };
		expect(authorizeAgentCommand(intent, context())).toEqual({ ok: false, reason: "command-not-granted" });
	});

	it("allows integration.invoke once granted, targeting an Integration that declares hasApi", () => {
		const intent: CommandIntent = { type: "integration.invoke", workspaceId: WORKSPACE, integrationId: ACTIVITY, action: "symbol.search", input: { query: "x" } };
		const outcome = authorizeAgentCommand(intent, context({ grant: grant({ allowedCommandTypes: new Set(["integration.invoke"]) }) }));
		expect(outcome).toEqual({ ok: true });
	});

	it("denies integration.invoke against an Integration that does not declare hasApi -- the same rationale as surface.dock's own check, since hasApi means exactly 'commands callable through this dispatch path'", () => {
		const intent: CommandIntent = { type: "integration.invoke", workspaceId: WORKSPACE, integrationId: TERMINAL, action: "anything", input: {} };
		const outcome = authorizeAgentCommand(
			intent,
			context({ grant: grant({ allowedCommandTypes: new Set(["integration.invoke"]) }), getIntegration: integrations({ id: TERMINAL, title: "Terminal", capabilities: { renderable: true, hasApi: false } }) }),
		);
		expect(outcome).toEqual({ ok: false, reason: "integration-lacks-api" });
	});

	it("denies integration.invoke when the grant never listed it, even though the target Integration has an API", () => {
		const intent: CommandIntent = { type: "integration.invoke", workspaceId: WORKSPACE, integrationId: ACTIVITY, action: "symbol.search", input: {} };
		expect(authorizeAgentCommand(intent, context())).toEqual({ ok: false, reason: "command-not-granted" });
	});
});
