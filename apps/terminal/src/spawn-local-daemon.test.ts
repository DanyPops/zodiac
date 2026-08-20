import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnLocalDaemon, type LocalDaemon } from "./spawn-local-daemon.js";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

let daemon: LocalDaemon | undefined;

beforeAll(() => {
	execFileSync("npm", ["run", "build", "--workspace=@zodiac/service"], { cwd: workspaceRoot, stdio: "inherit" });
}, 60_000);

afterEach(async () => {
	await daemon?.stop();
	daemon = undefined;
});

describe("spawnLocalDaemon", () => {
	it("spawns a real, separate zodiacd process and resolves its actual listening URL, reachable over real HTTP", async () => {
		daemon = await spawnLocalDaemon();
		expect(daemon.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

		const response = await fetch(`${daemon.baseUrl}/api/world`);
		expect(response.ok).toBe(true);
	}, 20_000);

	it("stop() actually terminates the spawned process -- a second daemon can bind cleanly afterward with no leaked port", async () => {
		daemon = await spawnLocalDaemon();
		const firstUrl = daemon.baseUrl;
		await daemon.stop();

		// The stopped daemon's own port no longer answers.
		await expect(fetch(firstUrl, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();

		// A fresh spawn afterward still works -- proves stop() didn't leave
		// this process's own zodiacd machinery in a broken state.
		daemon = await spawnLocalDaemon();
		const response = await fetch(`${daemon.baseUrl}/api/world`);
		expect(response.ok).toBe(true);
	}, 25_000);

	it("defaults to a fresh, ephemeral state dir per spawn -- a Workspace created in one local-server session never leaks into the next (the real, reproduced bug this test pins)", async () => {
		daemon = await spawnLocalDaemon();
		const createResponse = await fetch(`${daemon.baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "leftover-ws", title: "Leftover" } }),
		});
		expect(createResponse.ok).toBe(true);
		await daemon.stop();

		// A brand-new spawn, no stateDir given -- must NOT see the previous
		// spawn's own "Leftover" Workspace.
		daemon = await spawnLocalDaemon();
		const worldResponse = await fetch(`${daemon.baseUrl}/api/world`);
		const body = (await worldResponse.json()) as { workspaces?: { title?: string }[] };
		expect(body.workspaces?.some((workspace) => workspace.title === "Leftover")).toBe(false);
	}, 25_000);

	it("rejects with a clear, actionable message when the zodiacd binary itself cannot be found on PATH", async () => {
		await expect(
			(async () => {
				const originalPath = process.env.PATH;
				process.env.PATH = "/nonexistent-path-for-this-test-only";
				try {
					return await spawnLocalDaemon();
				} finally {
					process.env.PATH = originalPath;
				}
			})(),
		).rejects.toThrow(/could not spawn zodiacd/);
	}, 20_000);
});
