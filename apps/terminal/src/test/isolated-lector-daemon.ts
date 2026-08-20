import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connectLectorClientAt, type LectorClient, resolveLectorPaths } from "@danypops/lector";
import { readDaemonHandle } from "@danypops/vehicle-server/paths";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";

const require = createRequire(import.meta.url);

/**
 * Lector's own daemon unconditionally constructs a PushChannel (WebSocket-upgrade support),
 * which only Bun provides -- see startLectorDaemon's own "requires the Bun runtime" failure
 * under Node. Zodiac's own test runner is Node/Vitest, so a real isolated daemon here must
 * be a genuine separate Bun process, exactly like a real deployment -- never in-process.
 *
 * Spawn/bounded-stderr/graceful-shutdown lifecycle is @danypops/pi-process-harness's own
 * spawnManagedProcess, not hand-rolled here -- this file used to independently reimplement
 * exactly that (a real, found duplication -- see the "zodiacd adopts the ecosystem's real
 * daemon handle-file..." Papyrus Task). Readiness stays a handle/token-file poll raced
 * against the process's own early exit (spawnCompanionDaemon's own generic poll loop
 * doesn't race an early exit at all -- it would wait out the full timeout on a crash instead
 * of failing fast with the real stderr, a real regression this keeps deliberately avoiding).
 */
function lectorCliPath(): string {
	const packageJsonPath = require.resolve("@danypops/lector/package.json");
	return join(dirname(packageJsonPath), "src/cli.ts");
}

function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
	const startedAt = Date.now();
	return new Promise((resolveWait, reject) => {
		const poll = () => {
			if (predicate()) return resolveWait();
			if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Timed out waiting for ${description}`));
			setTimeout(poll, 25);
		};
		poll();
	});
}

/** A real, isolated Lector daemon (a real Bun subprocess) for tests -- own XDG roots, own real HTTP server, no shared state with any other running daemon on this machine. */
export async function startIsolatedLectorDaemon(): Promise<{ client: LectorClient; stop(): Promise<void> }> {
	const root = mkdtempSync(join(tmpdir(), "zodiac-tui-lector-daemon-"));
	const env = { ...process.env, XDG_DATA_HOME: root, XDG_STATE_HOME: root, XDG_RUNTIME_DIR: root, XDG_CONFIG_HOME: root };
	const paths = resolveLectorPaths({ env });

	let child: ManagedProcess | undefined;
	try {
		child = spawnManagedProcess({ command: "bun", args: [lectorCliPath(), "serve", "--dynamic-workspaces"], env });
		// A real exit later (e.g. this daemon's own stop() killing it after the race below
		// already settled the other way) would otherwise reject with no listener left --
		// swallowed here, not on `exited` itself, so the race below still sees the real
		// rejection if the process exits *before* readiness.
		const exited = child.waitForExit().then((code) => {
			throw new Error(`Lector daemon exited early (code ${code}): ${child?.stderr}`);
		});
		exited.catch(() => {});
		await Promise.race([waitFor(() => existsSync(paths.handle) && existsSync(paths.token), 15_000, "the Lector daemon handle/token files"), exited]);
	} catch (error) {
		await child?.dispose();
		rmSync(root, { recursive: true, force: true });
		throw error;
	}

	const handle = readDaemonHandle(paths.handle);
	if (!handle) {
		await child.dispose();
		rmSync(root, { recursive: true, force: true });
		throw new Error("Lector daemon wrote a handle file that could not be read back");
	}
	const token = readFileSync(paths.token, "utf8").trim();
	return {
		client: connectLectorClientAt(`http://${handle.host}:${handle.port}`, token),
		stop: async () => {
			await child?.dispose();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
