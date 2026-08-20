import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";

export interface LocalDaemon {
	readonly baseUrl: string;
	/** Sends SIGTERM to the spawned zodiacd, waits for it to actually exit (bounded at 2s), then removes its own ephemeral state directory if one was created for it. Always safe to call once. */
	readonly stop: () => Promise<void>;
}

const READY_LINE = /listening on (http:\/\/\S+)/;

export interface SpawnLocalDaemonOptions {
	/**
	 * Where the spawned zodiacd persists its own World snapshot. Defaults to
	 * a fresh temporary directory, created here and removed again in
	 * `stop()` -- "Local server" mode's own spawned daemon is exactly as
	 * transient as the Client that spawned it (killed alongside it, see
	 * cli.ts's own `stop()`), so its persisted state shouldn't outlive that
	 * Client either, unless a caller explicitly opts into a real, durable
	 * one by passing this. A real, reproduced bug during this task's own
	 * development: a shared *default* state dir across every local-server
	 * invocation meant a completely unrelated previous session's leftover
	 * Workspace silently reappeared in a supposedly fresh one.
	 */
	readonly stateDir?: string;
}

/**
 * Spawns a real, separate zodiacd process and waits for its own "listening
 * on <url>" stdout line -- the exact same signal
 * apps/terminal/src/bootstrap/daemon-attach.pty.test.ts already waits on
 * for a test-spawned daemon, reused here for a real "Local server" mode
 * Client (see the "apps/terminal: explicit mode selection" Papyrus Task's
 * own three-mode table: Local server is 2 processes, same machine, this
 * Client spawns the Server itself).
 *
 * Resolved by PATH (`spawn("zodiacd", ...)`), not a monorepo-relative
 * `require.resolve` -- `zodiacd` is a real, independently-installable npm
 * bin (apps/service's own package.json), the same assumption any real
 * multi-binary CLI suite makes (e.g. `docker` finding `docker-compose`).
 * Rejects with a clear, actionable message on ENOENT (not installed / not
 * on PATH) rather than a bare Node stack trace.
 *
 * `--port 0` lets the OS assign an ephemeral loopback port -- this Client
 * only ever needs to know the URL it gets back, never a fixed port number.
 */
export async function spawnLocalDaemon(options: SpawnLocalDaemonOptions = {}): Promise<LocalDaemon> {
	const ownedStateDir = options.stateDir === undefined ? mkdtempSync(join(tmpdir(), "zodiac-local-server-")) : undefined;
	const stateDir = options.stateDir ?? ownedStateDir!;
	const args = ["--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir];

	const child = spawn("zodiacd", args, { stdio: ["ignore", "pipe", "pipe"] }) as ChildProcessByStdio<null, Readable, Readable>;

	const baseUrl = await new Promise<string>((resolveReady, reject) => {
		let stdout = "";
		let stderr = "";
		const onData = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			const url = READY_LINE.exec(stdout)?.[1];
			if (url) {
				child.stdout.off("data", onData);
				resolveReady(url);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") {
				reject(new Error("could not spawn zodiacd -- is it installed and on PATH? (Local server mode needs the zodiacd binary alongside zodiac-tui)"));
			} else {
				reject(error);
			}
		});
		child.once("exit", (code) => reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${stderr}`)));
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${stderr}`)), 15_000);
	});

	return {
		baseUrl,
		stop: () =>
			new Promise<void>((resolveStop) => {
				function cleanupStateDirAndResolve(): void {
					if (ownedStateDir) rmSync(ownedStateDir, { recursive: true, force: true });
					resolveStop();
				}
				if (child.exitCode !== null || child.killed) {
					cleanupStateDirAndResolve();
					return;
				}
				child.once("exit", cleanupStateDirAndResolve);
				child.kill("SIGTERM");
				setTimeout(cleanupStateDirAndResolve, 2_000);
			}),
	};
}
