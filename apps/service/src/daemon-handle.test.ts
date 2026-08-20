import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Proves zodiacd's own adoption of the ecosystem's real daemon handle-file +
 * single-instance-lock convention (@danypops/vehicle-server/paths) -- see
 * the "zodiacd adopts the ecosystem's real daemon handle-file..." Papyrus
 * Task. Spawns the real built dist/cli.js, same discipline as
 * daemon-multi-client.test.ts, via @danypops/pi-process-harness's own
 * spawnManagedProcess rather than hand-rolling spawn/stderr/shutdown
 * plumbing a fourth time.
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;

function spawnZodiacd(stateDir: string, extraArgs: readonly string[] = []): ManagedProcess {
	return spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, ...extraArgs] });
}

async function waitForStdout(process: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<RegExpExecArray> {
	return new Promise((resolveMatch, reject) => {
		let stdout = "";
		const unsubscribe = process.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			const match = pattern.exec(stdout);
			if (match) {
				unsubscribe();
				resolveMatch(match);
			}
		});
		void process.waitForExit().then((code) => {
			if (!pattern.test(stdout)) reject(new Error(`zodiacd exited (code ${code}) without matching ${pattern}.\nstdout: ${stdout}\nstderr: ${process.stderr}`));
		});
		setTimeout(() => reject(new Error(`timed out waiting for ${pattern}.\nstdout: ${stdout}\nstderr: ${process.stderr}`)), timeoutMs);
	});
}

let stateDir: string | undefined;
let daemons: ManagedProcess[] = [];

afterEach(async () => {
	await Promise.all(daemons.map((daemon) => daemon.dispose()));
	daemons = [];
	if (stateDir) await rm(stateDir, { recursive: true, force: true });
	stateDir = undefined;
});

describe("zodiacd's own daemon handle file and single-instance lock", () => {
	it("writes a real, readable {host, port, pid} handle file at <stateDir>/daemon.json once listening", async () => {
		stateDir = await mkdtemp(join(tmpdir(), "zodiacd-handle-"));
		const daemon = spawnZodiacd(stateDir);
		daemons.push(daemon);
		const match = await waitForStdout(daemon, /listening on (http:\/\/\S+)/);
		const url = match[1];
		if (!url) throw new Error("waitForStdout matched with no capture group -- should be unreachable given the pattern");

		const handle = JSON.parse(readFileSync(join(stateDir, "daemon.json"), "utf8")) as { host: string; port: number; pid: number };
		expect(handle.host).toBe("127.0.0.1");
		expect(handle.port).toBe(Number(new URL(url).port));
		expect(handle.pid).toBe(daemon.pid);
	});

	it("a second zodiacd against the same stateDir fails fast, naming the existing holder's pid -- never silently binds a second port", async () => {
		stateDir = await mkdtemp(join(tmpdir(), "zodiacd-handle-conflict-"));
		const first = spawnZodiacd(stateDir);
		daemons.push(first);
		await waitForStdout(first, /listening on (http:\/\/\S+)/);

		const second = spawnZodiacd(stateDir);
		daemons.push(second);
		const exitCode = await second.waitForExit();
		expect(exitCode).not.toBe(0);
		expect(second.stderr).toContain("already holds");
		expect(second.stderr).toContain(String(first.pid));
	});

	it("a fresh zodiacd against a DIFFERENT stateDir starts normally even while another is running -- zodiacd is legitimately multi-instance, not a machine-wide singleton", async () => {
		const stateDirA = await mkdtemp(join(tmpdir(), "zodiacd-handle-multi-a-"));
		const stateDirB = await mkdtemp(join(tmpdir(), "zodiacd-handle-multi-b-"));
		try {
			const daemonA = spawnZodiacd(stateDirA);
			daemons.push(daemonA);
			await waitForStdout(daemonA, /listening on (http:\/\/\S+)/);

			const daemonB = spawnZodiacd(stateDirB);
			daemons.push(daemonB);
			await expect(waitForStdout(daemonB, /listening on (http:\/\/\S+)/)).resolves.toBeDefined();
		} finally {
			await rm(stateDirA, { recursive: true, force: true });
			await rm(stateDirB, { recursive: true, force: true });
		}
	});

	it("removes its own handle file and releases the lock on a clean SIGTERM shutdown -- a fresh instance against the same stateDir starts normally afterward", async () => {
		stateDir = await mkdtemp(join(tmpdir(), "zodiacd-handle-cleanup-"));
		const first = spawnZodiacd(stateDir);
		daemons.push(first);
		await waitForStdout(first, /listening on (http:\/\/\S+)/);
		await first.dispose();
		daemons = daemons.filter((daemon) => daemon !== first);

		const second = spawnZodiacd(stateDir);
		daemons.push(second);
		await expect(waitForStdout(second, /listening on (http:\/\/\S+)/)).resolves.toBeDefined();
	});
});
