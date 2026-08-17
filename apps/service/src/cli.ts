#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { appletId, panelId, worldId, type IntegrationDefinition, type IntegrationId, type Panel } from "@zodiac/protocol";
import { createJsonFileSnapshotPort, createWorldStore, hydrateWorldStore, type WorldStore, type WorldStorePanelOptions } from "@zodiac/server/world";
import { createAppletRegistry, seedBuiltinApplets } from "@zodiac/server";
import { createInMemoryToolRegistrar, watchWorkspaceToolGrants, type ToolContribution } from "@zodiac/server/agent";
import { createZodiacAgentSession } from "@zodiac/pi";
import type { AgentIntegrationPort } from "@zodiac/agent";
import { createZodiacService } from "./server.js";
import { parseZodiacdArgs } from "./parse-args.js";
import { resolveZodiacServiceStateDir } from "./state-dir.js";
import { createNodePtyFactory } from "./terminal/terminal-pty-port.js";

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

/** Constructs a real, live agent session per zodiacd agent-session request -- "rpc" mode, the same headless character pi's own `pi --mode rpc` subprocess has, since a daemon session has no interactive TUI of its own. Falls back to the daemon's own process cwd when a client doesn't request one. */
async function createDaemonAgentIntegration(cwd?: string): Promise<AgentIntegrationPort> {
	const { integration } = await createZodiacAgentSession({ cwd: cwd ?? process.cwd(), mode: "rpc" });
	return integration;
}

/** Test-only injection point for a stub Integration/tool-contribution pair, JSON-encoded (no real Integration declares hasApi:true yet) -- production runs with both empty, granting nothing. */
function loadToolGrantConfig(): { getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined; getContribution: (id: IntegrationId) => ToolContribution | undefined } {
	const integrations = JSON.parse(process.env["ZODIAC_TOOL_INTEGRATIONS"] ?? "[]") as readonly IntegrationDefinition[];
	const contributions = JSON.parse(process.env["ZODIAC_TOOL_CONTRIBUTIONS"] ?? "[]") as readonly ToolContribution[];
	return {
		getIntegration: (id) => integrations.find((definition) => definition.id === id),
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
	const { getIntegration, getContribution } = loadToolGrantConfig();
	watchWorkspaceToolGrants(world, getIntegration, getContribution, toolRegistrar);

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
	});
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
