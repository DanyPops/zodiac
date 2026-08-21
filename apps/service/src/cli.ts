#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { acquireDaemonLock, LOOPBACK_HOST, releaseDaemonLock, removeDaemonHandle, writeDaemonHandle } from "@danypops/vehicle-server/paths";
import { appletId, COMMAND_INTENT_MIN_VERSION, panelId, worldId, type CommandIntent, type ContributionCommand, type ContributionResourceProvider, type IntegrationDefinition, type IntegrationId, type Panel, type WorkspaceId } from "@zodiac/protocol";
import { createJsonFileSnapshotPort, createWorldStore, hydrateWorldStore, type WorldStore, type WorldStorePanelOptions } from "@zodiac/server/world";
import { createAppletRegistry, createEventBus, seedBuiltinApplets, type AppletRegistry } from "@zodiac/server";
import { loadConfiguredIntegrationPackages } from "@zodiac/server/contribution-loader";
import { createApprovalCenter, bridgeVehicleRegistryApprovals } from "@zodiac/server/approval";
import { createSharedVehicleSurfaceGateway, registerVisualCueOperations } from "@zodiac/server/vehicle";
import { registerVehicleGrantOperation } from "@danypops/vehicle-server/grant";
import { VehicleJobStore } from "@danypops/vehicle-server/jobs";
import { createInMemoryToolRegistrar, createPendingClientActions, watchWorkspaceToolGrants, type PendingClientActions, type ToolContribution } from "@zodiac/server/agent";
import { createAgentCommandTool, createListAgentSpaceTool, createListIntegrationsTool, createListVisualCuesTool, createListWorkspaceTool, createListWorkspacesTool, createRemoteBrowserVisualCueClient, createVisualCueVehicleResourceLoader, createZodiacAgentSession } from "@zodiac/pi";
import { resolveZodiacAgentDir } from "@zodiac/server/pi-agent-dir";
import { HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { LocalVehicleClient } from "@danypops/vehicle-client/local";
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

function defaultWorldPanelOptions(registry: AppletRegistry): WorldStorePanelOptions {
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
function createDaemonAgentIntegrationFactory(
	getIntegration: (id: IntegrationId) => IntegrationDefinition | undefined,
	getAllIntegrations: () => readonly IntegrationDefinition[],
	getDaemonBaseUrl: () => string,
	vehicleClient: LocalVehicleClient,
	pendingClientActions: PendingClientActions,
) {
	return async function createDaemonAgentIntegration(cwd?: string, initialActiveToolNames?: readonly string[], workspaceId?: WorkspaceId): Promise<AgentIntegrationPort> {
		// Read-only discovery, no Workspace/grant scoping at all (see
		// createListVisualCuesTool's own doc comment -- no real cue-target user
		// story is Workspace-scoped) -- active in both branches below, the same
		// reasoning list_integrations/list_workspaces already establish for their
		// own genuinely global, Workspace-independent read-only posture (see the
		// "Reshape list_integrations" Papyrus Task). list_workspace/list_agentspace
		// stay Workspace-branch-only below, deliberately -- both reveal one specific
		// Workspace's own docked state, which a cwd-only, non-Workspace-bound
		// session has no other access to either; same conservative scoping
		// zodiac_dispatch_command/propose_visual_cue already get.
		const listVisualCuesTool = createListVisualCuesTool((toolCallId) => createRemoteBrowserVisualCueClient(pendingClientActions, toolCallId));
		const listIntegrationsTool = createListIntegrationsTool({ getAllIntegrations });
		const listWorkspacesTool = createListWorkspacesTool({ daemonUrl: getDaemonBaseUrl() });
		if (!workspaceId) {
			const { integration } = await createZodiacAgentSession({
				cwd: cwd ?? process.cwd(),
				mode: "rpc",
				initialActiveToolNames: initialActiveToolNames !== undefined ? [...initialActiveToolNames, listVisualCuesTool.name, listIntegrationsTool.name, listWorkspacesTool.name] : undefined,
				customTools: [listVisualCuesTool, listIntegrationsTool, listWorkspacesTool],
			});
			return integration;
		}
		const dispatchTool = createAgentCommandTool({
			daemonUrl: getDaemonBaseUrl(),
			grant: { workspaceId, allowedCommandTypes: new Set(ALL_COMMAND_INTENT_TYPES) },
			sessionPolicy: { allowed: true },
			getIntegration,
		});
		// Read-only, so they carry no grant/session-policy check of their own --
		// dbed439e's own point is that seeing what exists is a strictly weaker
		// capability than acting on it (zodiac_dispatch_command already gates that).
		const listWorkspaceTool = createListWorkspaceTool({ daemonUrl: getDaemonBaseUrl(), getAllIntegrations });
		const listAgentSpaceTool = createListAgentSpaceTool({ daemonUrl: getDaemonBaseUrl(), getAllIntegrations });
		// propose_visual_cue -- the first Zodiac agent tool built the real Vehicle way
		// (registerVehicleTools), projected fresh per session (tool registration is inherently
		// per-ExtensionAPI) but backed by the one shared, daemon-wide VehicleRegistry/
		// LocalVehicleClient constructed once in main() -- approval/job state stays shared across
		// every session, never fragmented per-session the way createMonolithVehicle's own fresh-
		// registry-per-call would.
		const sessionCwd = cwd ?? process.cwd();
		const resourceLoader = await createVisualCueVehicleResourceLoader(vehicleClient, sessionCwd, resolveZodiacAgentDir());
		const { integration } = await createZodiacAgentSession({
			cwd: sessionCwd,
			mode: "rpc",
			resourceLoader,
			// Every custom tool must stay active even when initialActiveToolNames is [] (zero docked
			// Integrations) -- zodiac_dispatch_command is the trusted, per-call-authorized escape hatch
			// (including surface.dock itself); list_workspace/list_agentspace are how the agent discovers
			// what's docked/callable there even before anything is; propose_visual_cue is gated by
			// Vehicle's own Approval Gate, not by this Workspace tool grant, but still needs to be
			// reachable at all; list_visual_cues/list_integrations/list_workspaces are the same
			// read-only, Workspace-independent posture.
			initialActiveToolNames: initialActiveToolNames !== undefined ? [...initialActiveToolNames, dispatchTool.name, listWorkspaceTool.name, listAgentSpaceTool.name, listVisualCuesTool.name, listIntegrationsTool.name, listWorkspacesTool.name, "propose_visual_cue"] : undefined,
			customTools: [dispatchTool, listWorkspaceTool, listAgentSpaceTool, listVisualCuesTool, listIntegrationsTool, listWorkspacesTool],
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
async function loadOrCreateWorld(snapshotPort: ReturnType<typeof createJsonFileSnapshotPort>, applets: AppletRegistry): Promise<WorldStore> {
	const panelOptions = defaultWorldPanelOptions(applets);
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

	// Scoped to this instance's own stateDir, not a single shared machine-wide
	// XDG location the way @danypops/vehicle-server/paths's own resolveDaemonPaths
	// assumes -- zodiacd is legitimately multi-instance by design (every test in
	// this repo already spawns several concurrent zodiacd processes, each with
	// its own --state-dir; daemon-multi-client.test.ts and
	// daemon-attach.pty.test.ts both rely on this). The real invariant worth
	// enforcing is narrower than "one zodiacd on this machine, ever": it's "at
	// most one zodiacd writing to *this* World snapshot at a time" -- exactly
	// what scoping both the lock and the handle to stateDir itself protects,
	// while still reusing writeDaemonHandle/readDaemonHandle/acquireDaemonLock's
	// own atomic (write-then-rename / O_CREAT|O_EXCL), validated-shape
	// implementations rather than reinventing them (see the "zodiacd adopts the
	// ecosystem's real daemon handle-file + single-instance-lock convention"
	// Papyrus Task).
	const handlePath = join(stateDir, "daemon.json");
	const lockPath = join(stateDir, "daemon.lock");
	const lock = acquireDaemonLock(lockPath);
	if (!lock.acquired) {
		console.error(`[zodiacd] another zodiacd instance already holds ${stateDir} (pid ${lock.holderPid ?? "unknown"}) -- refusing to start a second one against the same state`);
		process.exit(1);
	}

	const sessionsRoot = args.sessionsRoot ?? DEFAULT_SESSIONS_ROOT;
	const snapshotPort = createJsonFileSnapshotPort({ filePath: join(stateDir, "world.json") });
	const applets = createAppletRegistry();
	seedBuiltinApplets(applets);
	const contributionCommands = new Map<string, ContributionCommand>();
	const contributionProviders = new Map<string, ContributionResourceProvider>();
	let configuredIntegrations: Awaited<ReturnType<typeof loadConfiguredIntegrationPackages>>;
	try {
		configuredIntegrations = await loadConfiguredIntegrationPackages({
			packageJsonPaths: args.integrationPackageJsonPaths,
			applets,
			host: {
				registerCommand(command) {
					if (contributionCommands.has(command.id)) throw new Error(`Duplicate configured contribution command: ${command.id}`);
					contributionCommands.set(command.id, command);
					return () => contributionCommands.delete(command.id);
				},
				registerResourceProvider(provider) {
					if (contributionProviders.has(provider.scheme)) throw new Error(`Duplicate configured contribution resource scheme: ${provider.scheme}`);
					contributionProviders.set(provider.scheme, provider);
					return () => contributionProviders.delete(provider.scheme);
				},
			},
		});
	} catch (error) {
		releaseDaemonLock(lockPath);
		throw error;
	}
	if (configuredIntegrations.integrations.length > 0) {
		console.log(`[zodiacd] loaded ${configuredIntegrations.integrations.length} configured Integration contribution(s): ${configuredIntegrations.integrations.map((entry) => `${entry.provenance.packageId}/${entry.kind}/${entry.id}`).join(", ")}`);
	}

	const world = await loadOrCreateWorld(snapshotPort, applets);

	const toolRegistrar = createInMemoryToolRegistrar();
	const { getIntegration, getAllIntegrations, getContribution } = loadToolGrantConfig();
	watchWorkspaceToolGrants(world, getIntegration, getContribution, toolRegistrar);

	// Real, shared instances -- constructed here (not left to createZodiacService's own
	// defaults) so future in-process publishers (e.g. a gated Integration invoke, once
	// integration.invoke handlers can themselves emit a VehicleApprovalRequest) share the
	// exact same bus/authority a connected client's /api/notifications stream reads from.
	//
	// One shared HmacApprovalAuthority, passed to BOTH createApprovalCenter and the
	// VehicleRegistry's own configureApprovals() below -- ordinary HMAC usage (mint()/verify()
	// are pure functions of the shared secret, not tied to one call site), not a special case.
	// This is what lets ApprovalCenter act as the single CQRS-shaped read model over both gate
	// sources (WorldStore.apply()'s own integration.invoke gate, which already calls
	// ApprovalCenter.request() directly, and any real VehicleRegistry operation below) without
	// vehicle.approval.resolve ever needing to be invoked for Zodiac's own resolution flow.
	const authority = new HmacApprovalAuthority();
	const bus = createEventBus();
	const approvalCenter = createApprovalCenter({ bus, authority });

	// zodiacd's first real VehicleRegistry -- shared daemon-wide across every agent session
	// (never a fresh one per session, which would fragment approval/job state). Registers
	// visual-cue.propose (see packages/server/src/vehicle/visual-cue-operations.ts) and
	// vehicle.grant.continue (the Grant primitive's own operation, needed for
	// visual-cue.propose's own Grant-aware step -- see that operation's own doc comment); more
	// operations register here as they land. The one-line bridge is the entire integration
	// needed for a request raised through this registry to show up in NotificationsPill,
	// completely unchanged -- see vehicle-registry-approval-bridge.ts's own doc comment.
	const vehicleRegistry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Zodiac's own daemon-hosted Vehicle operations." });
	registerVehicleGrantOperation(vehicleRegistry);
	registerVisualCueOperations(vehicleRegistry);
	vehicleRegistry.configureApprovals({ authority });
	bridgeVehicleRegistryApprovals(vehicleRegistry, approvalCenter);
	// Opts LocalVehicleClient into Vehicle Jobs (submitJob/pollJob/tailJob/steerJob/cancelJob) --
	// see the "propose_visual_cue: Grant-governed Job execution" Papyrus Task. Without this,
	// invokeOrRunAsJob's own capability check (descriptor.background?.supported &&
	// client.submitJob && client.pollJob) fails by construction regardless of what a descriptor
	// declares, and every background-capable operation silently falls back to a plain,
	// held-open invoke() -- confirmed directly before this task began, not assumed.
	const vehicleJobStore = new VehicleJobStore(vehicleRegistry);
	const vehicleClient = new LocalVehicleClient(vehicleRegistry, { jobStore: vehicleJobStore });

	// Set once the daemon is actually listening, just below -- see
	// createDaemonAgentIntegrationFactory's own doc comment on why this is
	// safe despite being read from a closure defined before that happens.
	let daemonBaseUrl: string | undefined;
	// Shared between list_visual_cues' own RemoteBrowserVisualCueClient (registers a pending
	// call per toolCallId) and agentRoutes' own postClientAction route (resolves it once a real
	// Client posts back) -- one instance, daemon-wide, never fragmented per-session.
	const pendingClientActions = createPendingClientActions();
	const createDaemonAgentIntegration = createDaemonAgentIntegrationFactory(getIntegration, getAllIntegrations, () => {
		if (!daemonBaseUrl) throw new Error("[zodiacd] createDaemonAgentIntegration called before the daemon finished binding its own HTTP server");
		return daemonBaseUrl;
	}, vehicleClient, pendingClientActions);

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

	const vehicleSurfaces = createSharedVehicleSurfaceGateway({
		definitions: [{ id: "papyrus", title: "Papyrus", vehicleName: "papyrus", invalidationTopics: ["tasks"] }],
	});
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
		pendingClientActions,
		vehicleSurfaces,
		contributions: {
			descriptions: configuredIntegrations.integrations.flatMap((entry) => entry.description ? [entry.description] : []),
			commands: contributionCommands,
			providers: contributionProviders,
		},
	});
	daemonBaseUrl = service.baseUrl;

	// A real, machine-readable readiness signal -- the actual mechanism the
	// ecosystem already uses (papyrus/pipes/web-spider/jittor) for "is this
	// daemon alive, and what's its port" instead of a caller parsing stdout.
	// Written BEFORE the human-facing console.log below, deliberately: a
	// caller that still only knows to watch stdout (see the "zodiacd adopts
	// the ecosystem's real daemon handle-file..." Papyrus Task's own
	// migration-in-progress callers) must never observe "listening on" before
	// the handle file genuinely exists -- confirmed as a real, reproduced race
	// during this task's own development, not a hypothetical. DaemonHandle's
	// own `host` field is typed to the literal LOOPBACK_HOST ("127.0.0.1") --
	// every @danypops daemon binds loopback-only by hard invariant (see
	// paths.ts's own module doc comment), but zodiacd deliberately allows
	// `--host 0.0.0.0` (with an explicit warning above). Writing a handle
	// claiming "127.0.0.1" while actually bound elsewhere would be a real lie
	// in the one file this convention promises is trustworthy -- skip it
	// entirely in that case rather than force a false value through a type
	// assertion.
	const { hostname: handleHost, port: handlePort } = new URL(service.baseUrl);
	if (handleHost === LOOPBACK_HOST) {
		writeDaemonHandle(handlePath, { host: LOOPBACK_HOST, port: Number(handlePort), pid: process.pid });
	} else {
		console.error(`[zodiacd] not writing a daemon handle file: bound to ${handleHost}, not ${LOOPBACK_HOST} -- the handle-file convention only describes loopback daemons`);
	}

	console.log(`[zodiacd] listening on ${service.baseUrl} (World "${world.id}", sessions root: ${sessionsRoot}${args.enableTerminal ? ", terminal: enabled" : ""})`);

	let shuttingDown = false;
	const shutdown = (signal: string) => {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log(`[zodiacd] ${signal} received, shutting down`);
		removeDaemonHandle(handlePath);
		void configuredIntegrations.dispose()
			.catch((error: unknown) => console.error(`[zodiacd] configured Integration disposal failed: ${String(error)}`))
			.then(() => service.close())
			.finally(() => {
				releaseDaemonLock(lockPath);
				process.exit(0);
			});
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
	console.error(`[zodiacd] fatal: ${String(error)}`);
	process.exit(1);
});
