#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { worldId } from "@zodiac/protocol";
import { createJsonFileSnapshotPort, createWorldStore, hydrateWorldStore, type WorldStore } from "@zodiac/server/world";
import { createZodiacAgentSession } from "@zodiac/pi";
import type { AgentIntegrationPort } from "@zodiac/agent";
import { createZodiacService } from "./server.js";
import { parseZodiacdArgs } from "./parse-args.js";
import { resolveZodiacServiceStateDir } from "./state-dir.js";

const DEFAULT_SESSIONS_ROOT = join(homedir(), ".local", "share", "alef", "sessions");
const WORLD_ID = worldId("zodiac");

/** Constructs a real, live agent session per zodiacd agent-session request -- "rpc" mode, the same headless character pi's own `pi --mode rpc` subprocess has, since a daemon session has no interactive TUI of its own. Falls back to the daemon's own process cwd when a client doesn't request one. */
async function createDaemonAgentIntegration(cwd?: string): Promise<AgentIntegrationPort> {
	const { integration } = await createZodiacAgentSession({ cwd: cwd ?? process.cwd(), mode: "rpc" });
	return integration;
}

/** Loads the persisted World if one exists, exiting loudly on a corrupted snapshot rather than silently discarding it (see the JSON-file WorldSnapshotPort's own doc comment). */
async function loadOrCreateWorld(snapshotPort: ReturnType<typeof createJsonFileSnapshotPort>): Promise<WorldStore> {
	const loaded = await snapshotPort.load();
	if (loaded === undefined) return createWorldStore(WORLD_ID);

	const result = hydrateWorldStore(loaded);
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

	const service = await createZodiacService({ world, sessionsRoot, port: args.port, host: args.host, createAgentIntegration: createDaemonAgentIntegration });
	console.log(`[zodiacd] listening on ${service.baseUrl} (World "${world.id}", sessions root: ${sessionsRoot})`);

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
