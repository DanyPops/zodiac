import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ManagedProcess, spawnManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type LiveTerminal, spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(packageRoot, "../..");
const cli = resolve(packageRoot, "dist/cli.js");
const serviceCli = resolve(workspaceRoot, "apps/service/dist/cli.js");

/**
 * The end-to-end proof zodiacd stage 5 actually exists for: a real,
 * separately-spawned zodiacd process (not exercised in-process) and a real
 * apps/terminal CLI process attached to it in a real PTY, showing the same
 * World state a completely independent HTTP client sees and mutates. This
 * package's own unit tests (parse-args.test.ts, cli.ts's own choice between
 * connectRemoteWorldStore/createWorldStore) already prove the wiring in
 * isolation; this file is the one that proves it actually works end to end,
 * the same discipline apps/service's own daemon-multi-client.test.ts already
 * established for zodiacd itself.
 *
 * Spawn/bounded-stderr/graceful-shutdown lifecycle is @danypops/pi-process-harness's own
 * spawnManagedProcess, not hand-rolled here -- this file used to independently reimplement
 * exactly that (a real, found duplication: the "zodiacd adopts the ecosystem's real daemon
 * handle-file + single-instance-lock convention" Papyrus Task's own root-cause finding).
 * Readiness itself is still a stdout-regex parse (not yet the real handle-file convention
 * that task adopts for zodiacd's own production startup) -- migrating this file's own
 * `onStdout` predicate onto a handle-file read is that task's own scope, once zodiacd writes
 * one; only the spawn/stderr/shutdown plumbing is fixed here.
 */
async function waitForZodiacdReady(managedProcess: ManagedProcess): Promise<string> {
	return new Promise((resolveReady, reject) => {
		let stdout = "";
		const unsubscribe = managedProcess.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			const url = /listening on (http:\/\/\S+)/.exec(stdout)?.[1];
			if (url) {
				unsubscribe();
				resolveReady(url);
			}
		});
		void managedProcess.waitForExit().then((code) => {
			if (!stdout.includes("listening on")) reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${managedProcess.stderr}`));
		});
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${managedProcess.stderr}`)), 15_000);
	});
}

let daemon: ManagedProcess | undefined;
let stateDir: string | undefined;
let workspaceDir: string | undefined;
let terminal: LiveTerminal | undefined;

beforeAll(() => {
	// Mirrors apps/web's own Playwright webServer command's exact precedent
	// (`cd ../.. && npm run build --workspace=@zodiac/service && ...`): this
	// file spawns apps/service's own built dist/cli.js as a real, separate
	// process, so it must guarantee that build is fresh itself rather than
	// assuming some other test/workspace already produced it.
	execFileSync("npm", ["run", "build", "--workspace=@zodiac/service"], { cwd: workspaceRoot, stdio: "inherit" });
}, 60_000);

afterEach(async () => {
	await terminal?.dispose();
	terminal = undefined;
	await daemon?.dispose();
	daemon = undefined;
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
	stateDir = undefined;
	if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
	workspaceDir = undefined;
});

async function startDaemon(): Promise<string> {
	stateDir = mkdtempSync(join(tmpdir(), "zodiacd-terminal-attach-"));
	daemon = spawnManagedProcess({ command: process.execPath, args: [serviceCli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir] });
	return waitForZodiacdReady(daemon);
}

describe("apps/terminal attaching to a real zodiacd (stage 5)", () => {
	it("a bootstrapped workspace, opened by a real terminal process attached to a real daemon, becomes visible through the daemon's own plain HTTP API -- not just rendered locally", async () => {
		const url = await startDaemon();
		workspaceDir = mkdtempSync(join(tmpdir(), "zodiac-terminal-attach-dir-"));
		writeFileSync(join(workspaceDir, "a.ts"), "export const a = 1;\n");
		const rootTitle = basename(workspaceDir);

		terminal = spawnLiveTerminal(process.execPath, [cli, workspaceDir, "--daemon", url], { cols: 80, rows: 24 });
		await terminal.waitForText(rootTitle, 15_000);

		// The real, discriminating check: if the terminal had silently fallen
		// back to an embedded WorldStore (e.g. a bug in attachToDaemon), the
		// screen would still show the same title -- bootstrap works either way.
		// Only a real remote attachment makes the *daemon's own* World contain
		// it, visible to a completely independent HTTP client.
		const response = await fetch(`${url}/api/world`);
		expect(response.ok).toBe(true);
		const body = (await response.json()) as { workspaces?: { title?: string }[] };
		expect(body.workspaces?.some((workspace) => workspace.title === rootTitle)).toBe(true);
	}, 25_000);

	it("a Surface docked by an independent HTTP client appears live in the running terminal", async () => {
		const url = await startDaemon();
		workspaceDir = mkdtempSync(join(tmpdir(), "zodiac-terminal-live-update-"));
		writeFileSync(join(workspaceDir, "a.ts"), "export const a = 1;\n");
		const rootTitle = basename(workspaceDir);

		// No positional path deliberately exercises cwd bootstrap while the remote daemon remains
		// the sole World authority. The independent client mutates that already-open Workspace.
		terminal = spawnLiveTerminal(process.execPath, [cli, "--daemon", url], { cols: 80, rows: 24, cwd: workspaceDir });
		await terminal.waitForText(rootTitle, 15_000);
		const worldResponse = await fetch(`${url}/api/world`);
		expect(worldResponse.ok).toBe(true);
		const world = (await worldResponse.json()) as { workspaces?: Array<{ id?: string }> };
		const activeWorkspaceId = world.workspaces?.[0]?.id;
		expect(activeWorkspaceId).toBeDefined();

		const distinctiveTitle = "Remote Surface";
		const response = await fetch(`${url}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: activeWorkspaceId, integrationId: "remote-fixture", title: distinctiveTitle } }),
		});
		expect(response.ok).toBe(true);

		await terminal.waitForText(distinctiveTitle, 10_000);
	}, 25_000);

	it("--mode remote with an unreachable --daemon is a real, explicit startup error -- never a silent fallback to embedded mode", async () => {
		workspaceDir = mkdtempSync(join(tmpdir(), "zodiac-terminal-attach-unreachable-"));
		writeFileSync(join(workspaceDir, "a.ts"), "export const a = 1;\n");

		// Port 1 is a real, always-refused-connection target on any normal
		// machine (a genuinely privileged/unassigned port) -- no daemon needs
		// to be started at all for this case. --daemon alone (with no --mode)
		// still implies "remote" (see parseTerminalArgs's own doc comment) --
		// the fix this test proves is that "remote" itself no longer degrades
		// silently, not that the ergonomic single-flag inference changed.
		terminal = spawnLiveTerminal(process.execPath, [cli, workspaceDir, "--daemon", "http://127.0.0.1:1"], { cols: 80, rows: 24 });
		const exitCode = await terminal.waitForExit(15_000);
		expect(exitCode).not.toBe(0);
		expect(terminal.rawOutput()).toContain("could not reach zodiacd");
		expect(terminal.rawOutput()).not.toContain("falling back");
	}, 20_000);

	it("--mode local-server spawns a real, separate zodiacd itself and attaches to it -- no --daemon needed at all", async () => {
		workspaceDir = mkdtempSync(join(tmpdir(), "zodiac-terminal-local-server-"));
		writeFileSync(join(workspaceDir, "a.ts"), "export const a = 1;\n");
		const rootTitle = basename(workspaceDir);

		terminal = spawnLiveTerminal(process.execPath, [cli, workspaceDir, "--mode", "local-server"], { cols: 80, rows: 24 });
		await terminal.waitForText(rootTitle, 15_000);

		// The real, discriminating check, same discipline as the "remote" test
		// above: find the zodiacd this process itself spawned via its own
		// diagnostic line (see cli.ts's own resolveBacking -- the spawned
		// daemon's own stdout is captured internally by spawnLocalDaemon, never
		// forwarded to this terminal's own screen, so this is the one real,
		// observable signal), then confirm the bootstrapped workspace genuinely
		// landed in *that* daemon's own World -- not just rendered locally by an
		// embedded WorldStore.
		const url = /spawned zodiacd at (http:\/\/\S+)/.exec(terminal.rawOutput())?.[1];
		expect(url).toBeDefined();
		const response = await fetch(`${url}/api/world`);
		expect(response.ok).toBe(true);
		const body = (await response.json()) as { workspaces?: { title?: string }[] };
		expect(body.workspaces?.some((workspace) => workspace.title === rootTitle)).toBe(true);

		// Killing the terminal must also terminate the daemon it spawned -- no
		// orphaned process, the exact failure class opencode's own issue #9385
		// documented for an unrelated resource (subagent sessions never cleaned
		// up) but generalizes to any Client-spawned child process.
		await terminal.dispose();
		terminal = undefined;
		await new Promise((resolve) => setTimeout(resolve, 500));
		await expect(fetch(url!, { signal: AbortSignal.timeout(1_000) })).rejects.toThrow();
	}, 25_000);
});
