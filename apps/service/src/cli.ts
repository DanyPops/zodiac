#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { appletId, COMMAND_INTENT_MIN_VERSION, panelId, worldId, type CommandIntent, type IntegrationDefinition, type IntegrationId, type Panel, type WorkspaceId } from "@zodiac/protocol";
import { createJsonFileSnapshotPort, createWorldStore, hydrateWorldStore, type WorldStore, type WorldStorePanelOptions } from "@zodiac/server/world";
import { createAppletRegistry, createEventBus, seedBuiltinApplets } from "@zodiac/server";
import { createApprovalCenter } from "@zodiac/server/approval";
import { createInMemoryToolRegistrar, watchWorkspaceToolGrants, type ToolContribution } from "@zodiac/server/agent";
import { createAgentCommandTool, createListIntegrationsTool, createZodiacAgentSession } from "@zodiac/pi";
import type { AgentIntegrationPort } from "@zodiac/agent";
import { createZodiacService } from "./server.js";
import { parseZodiacdArgs } from "./parse-args.js";
import { resolveZodiacServiceStateDir } from "./state-dir.js";
import { createNodePtyFactory } from "./terminal/terminal-pty-port.js";

/** Every CommandIntent variant, derived from the schema's own version table rather than hand-listed, so a new variant is granted automatically instead of silently staying ungranted. allowedCommandTypes curation beyond "scoped to this session's Workspace" is c166f10b's own separate concern, not this wiring's. */
const ALL_COMMAND_INTENT_TYPES = Object.keys(COMMAND_INTENT_MIN_VERSION) as readonly CommandIntent["type"][];

const DEFAULT_SESSIONS_ROOT = join(homedir(), ".local", "share", "alef", "sessions");
const WORLD_ID = worldId("zodiac");

/**
 * Real starting World chrome -- apps/terminal's own DEFAULT_CHAT_PANEL
 * precedent, applied to the two real Web pillars for the first time. `left`
 * matches the TUI's own DEFAULT_EDGE_APPLET_IDS.left fallback exactly (both
 * already default to workspace-nav), so this changes nothing visually for
 * either client until something moves it. `right` replaces the TUI's own
 * always-empty "integrations-nav" placeholder (appletContentFor has no real
 * content for it either) with "surface-templates" -- a real Web feature
 * with nothing to show on the TUI, which is why it isn't taught to
 * appletContentFor: rendering blank there is correct, not a bug, the same
 * as the placeholder it replaced.
 *
 * thicknessUnit: "px" on both -- these values are Web's own CSS pixels
 * (256 matches WorkspaceSelection's default *expanded* width exactly,
 * see preferences.ts's own readCollapsed() default of false; 56 matches
 * SurfaceTemplatesPillar's fixed w-14), ignored by the TUI's own geometry
 * per PanelThicknessUnit's own doc comment (packages/protocol/src/panel.ts).
 *
 * Not persisted across a restart: WorldStore.snapshot() carries no Panel
 * state at all today, so a real panel.move survives only until the next
 * daemon restart, which re-seeds these defaults -- a known, accepted gap
 * for this first cut (Panel persistence is its own separate task).
 */
const DEFAULT_WORLD_PANELS: readonly Panel[] = [
	{ id: panelId("workspace-nav"), location: "left", alignment: "start", offset: 0, thickness: 256, thicknessUnit: "px", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: appletId("settings"), body: [appletId("workspace-nav")] },
	{ id: panelId("surface-templates"), location: "right", alignment: "start", offset: 0, thickness: 56, thicknessUnit: "px", lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [appletId("surface-templates")] },
];

function defaultWorldPanelOptions(): WorldStorePanelOptions {
	const registry = createAppletRegistry();
	seedBuiltinApplets(registry);
	const byId = new Map(registry.applets().map((applet) => [applet.id, applet]));
	return { panels: DEFAULT_WORLD_PANELS, getApplet: (id) => byId.get(id) };
}

/**
 * Constructs a real, live agent session per zodiacd agent-session request --
 * "rpc" mode, since a daemon session has no interactive TUI. Falls back to
 * the daemon's own cwd when unrequested. initialActiveToolNames enforces a
 * Workspace's own tool grant (see agent-routes.ts's createSession).
 *
 * A session gets the real zodiac_dispatch_command tool only when a
 * workspaceId is present -- a cwd-only caller with no Workspace gets no
 * grant and no dispatch tool at all, never an implicit default Workspace.
 * getDaemonBaseUrl is a closure, not a plain string, because this factory is
 * constructed before the daemon's own HTTP server has bound a real port;
 * it's only ever called once a session is actually requested, by which
 * point the daemon is already listening.
 */
function createDaemonAgentIntegrationFactory(getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined, getAllIntegrations: () => readonly IntegrationDefinition[], getDaemonBaseUrl: () => string) {
	return async function createDaemonAgentIntegration(cwd?: string, initialActiveToolNames?: readonly string[], workspaceId?: WorkspaceId): Promise<AgentIntegrationPort> {
		if (!workspaceId) {
			const { integration } = await createZodiacAgentSession({ cwd: cwd ?? process.cwd(), mode: "rpc", initialActiveToolNames });
			return integration;
		}
		const dispatchTool = createAgentCommandTool({
			daemonUrl: getDaemonBaseUrl(),
			grant: { workspaceId, allowedCommandTypes: new Set(ALL_COMMAND_INTENT_TYPES) },
			sessionPolicy: { allowed: true },
			getIntegration,
		});
		// Read-only, so it carries no grant/session-policy check of its own --
		// dbed439e's own point is that seeing what exists is a strictly weaker
		// capability than acting on it (zodiac_dispatch_command already gates that).
		const listTool = createListIntegrationsTool({ daemonUrl: getDaemonBaseUrl(), getAllIntegrations });
		const { integration } = await createZodiacAgentSession({
			cwd: cwd ?? process.cwd(),
			mode: "rpc",
			// Both custom tools must stay active even when initialActiveToolNames is [] (zero docked
			// Integrations) -- zodiac_dispatch_command is the trusted, per-call-authorized escape hatch
			// (including surface.dock itself); list_integrations is how the agent discovers that hatch
			// even has anything to dock in the first place. Neither is a Vehicle-shaped granted tool.
			initialActiveToolNames: initialActiveToolNames !== undefined ? [...initialActiveToolNames, dispatchTool.name, listTool.name] : undefined,
			customTools: [dispatchTool, listTool],
		});
		return integration;
	};
}

/** Test-only injection point for a stub Integration/tool-contribution pair, JSON-encoded (no real Integration declares hasApi:true yet) -- production runs with both empty, granting nothing. */
function loadToolGrantConfig(): { getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined; getAllIntegrations: () => readonly IntegrationDefinition[]; getContribution: (id: IntegrationId) => ToolContribution | undefined } {
	const integrations = JSON.parse(process.env["ZODIAC_TOOL_INTEGRATIONS"] ?? "[]") as readonly IntegrationDefinition[];
	const contributions = JSON.parse(process.env["ZODIAC_TOOL_CONTRIBUTIONS"] ?? "[]") as readonly ToolContribution[];
	return {
		getIntegration: (id) => integrations.find((definition) => definition.id === id),
		getAllIntegrations: () => integrations,
		getContribution: (id) => contributions.find((definition) => definition.integrationId === id),
	};
}

/** Loads the persisted World if one exists, exiting loudly on a corrupted snapshot rather than silently discarding it (see the JSON-file WorldSnapshotPort's own doc comment). */
async function loadOrCreateWorld(snapshotPort: ReturnType<typeof createJsonFileSnapshotPort>): Promise<WorldStore> {
	const panelOptions = defaultWorldPanelOptions();
	const loaded = await snapshotPort.load();
	if (loaded === undefined) return createWorldStore(WORLD_ID, panelOptions);

	const result = hydrateWorldStore(loaded, panelOptions);
	if (!result.ok) {
		console.error(`[zodiacd] persisted World snapshot failed validation: ${result.issues.join("; ")}`);
		process.exit(1);
	}
	return result.value;
}

async function main(): Promise<void> {
	const args = parseZodiacdArgs(process.argv.slice(2));
	const stateDir = args.stateDir ?? resolveZodiacServiceStateDir();
	const sessionsRoot = args.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
	const snapshotPort = createJsonFileSnapshotPort({ filePath: join(stateDir, "world.json") });

	const world = await loadOrCreateWorld(snapshotPort);

	const toolRegistrar = createInMemoryToolRegistrar();
	const { getIntegration, getAllIntegrations, getContribution } = loadToolGrantConfig();
	watchWorkspaceToolGrants(world, getIntegration, getContribution, toolRegistrar);

	// Real, shared instances -- constructed here (not left to createZodiacService's own
	// defaults) so future in-process publishers (e.g. a gated Integration invoke, once
	// integration.invoke handlers can themselves emit a VehicleApprovalRequest) share the
	// exact same bus/authority a connected client's /api/notifications stream reads from.
	const bus = createEventBus();
	const approvalCenter = createApprovalCenter({ bus });

	// Set once the daemon is actually listening, just below -- see
	// createDaemonAgentIntegrationFactory's own doc comment on why this is
	// safe despite being read from a closure defined before that happens.
	let daemonBaseUrl: string | undefined;
	const createDaemonAgentIntegration = createDaemonAgentIntegrationFactory(getIntegration, getAllIntegrations, () => {
		if (!daemonBaseUrl) throw new Error("[zodiacd] createDaemonAgentIntegration called before the daemon finished binding its own HTTP server");
		return daemonBaseUrl;
	});

	// Fire-and-forget persistence on every change -- a snapshot a few
	// milliseconds stale after an unclean shutdown is an acceptable loss;
	// blocking every command on a disk write is not.
	world.onChange(() => {
		void snapshotPort.save(world.snapshot()).catch((error: unknown) => {
			console.error(`[zodiacd] failed to persist World snapshot: ${String(error)}`);
		});
	});

	if (args.host === "0.0.0.0") {
		process.stderr.write("[zodiacd] WARNING: binding to 0.0.0.0 exposes the daemon to the network. No auth is implemented yet.\n");
	}
	if (args.enableTerminal) {
		process.stderr.write("[zodiacd] WARNING: --enable-terminal exposes a real shell over the network. No auth is implemented yet -- loopback only.\n");
	}

	const service = await createZodiacService({
		world,
		sessionsRoot,
		port: args.port,
		host: args.host,
		fixtureMode: args.fixtureMode,
		createAgentIntegration: createDaemonAgentIntegration,
		enableTerminal: args.enableTerminal,
		createTerminalPty: args.enableTerminal ? createNodePtyFactory() : undefined,
		getWorkspaceToolIds: toolRegistrar.toolIds,
		bus,
		approvalCenter,
	});
	daemonBaseUrl = service.baseUrl;
	console.log(`[zodiacd] listening on ${service.baseUrl} (World "${world.id}", sessions root: ${sessionsRoot}${args.enableTerminal ? ", terminal: enabled" : ""})`);

	const shutdown = (signal: string) => {
		console.log(`[zodiacd] ${signal} received, shutting down`);
		void service.close().then(() => process.exit(0));
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
	console.error(`[zodiacd] fatal: ${String(error)}`);
	process.exit(1);
});
