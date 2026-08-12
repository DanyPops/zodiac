import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connectLectorClientAt, type LectorClient, resolveLectorPaths } from "@danypops/lector";
import { readDaemonHandle } from "@danypops/vehicle-server/paths";

const require = createRequire(import.meta.url);

/**
 * Lector's own daemon unconditionally constructs a PushChannel (WebSocket-upgrade support),
 * which only Bun provides -- see startLectorDaemon's own "requires the Bun runtime" failure
 * under Node. Zodiac's own test runner is Node/Vitest, so a real isolated daemon here must
 * be a genuine separate Bun process, exactly like a real deployment -- never in-process.
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

	let child: ChildProcess | undefined;
	let stderr = "";
	try {
		child = spawn("bun", [lectorCliPath(), "serve", "--dynamic-workspaces"], { env, stdio: ["ignore", "ignore", "pipe"] });
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const exited = new Promise<never>((_resolveExit, rejectExit) => {
			child?.once("exit", (code) => rejectExit(new Error(`Lector daemon exited early (code ${code}): ${stderr}`)));
		});
		await Promise.race([waitFor(() => existsSync(paths.handle) && existsSync(paths.token), 15_000, "the Lector daemon handle/token files"), exited]);
	} catch (error) {
		child?.kill();
		rmSync(root, { recursive: true, force: true });
		throw error;
	}

	const handle = readDaemonHandle(paths.handle);
	if (!handle) {
		child.kill();
		rmSync(root, { recursive: true, force: true });
		throw new Error("Lector daemon wrote a handle file that could not be read back");
	}
	const token = readFileSync(paths.token, "utf8").trim();
	return {
		client: connectLectorClientAt(`http://${handle.host}:${handle.port}`, token),
		stop: async () => {
			child?.kill();
			await new Promise<void>((resolveStop) => child?.once("exit", () => resolveStop()));
			rmSync(root, { recursive: true, force: true });
		},
	};
}
