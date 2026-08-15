import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { type LiveTerminal, spawnLiveTerminal } from "../test/live-pty-terminal.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workspaceRoot = resolve(packageRoot, "../..");
const cli = resolve(packageRoot, "dist/cli.js");
const serviceCli = resolve(workspaceRoot, "apps/service/dist/cli.js");

type ZodiacdProcess = ChildProcessByStdio<null, Readable, Readable>;

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
 */
async function waitForZodiacdReady(child: ZodiacdProcess): Promise<string> {
	return new Promise((resolveReady, reject) => {
		let stdout = "";
		let stderr = "";
		const onData = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			const match = /listening on (http:\/\/\S+)/.exec(stdout);
			const url = match?.[1];
			if (url) {
				child.stdout.off("data", onData);
				resolveReady(url);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.once("exit", (code) => reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${stderr}`)));
		child.once("error", reject);
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${stderr}`)), 15_000);
	});
}

let daemon: ZodiacdProcess | undefined;
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
	if (daemon && !daemon.killed) {
		daemon.kill("SIGTERM");
		await new Promise<void>((resolveExit) => {
			daemon?.once("exit", () => resolveExit());
			setTimeout(resolveExit, 2_000);
		});
	}
	daemon = undefined;
	if (stateDir) rmSync(stateDir, { recursive: true, force: true });
	stateDir = undefined;
	if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true });
	workspaceDir = undefined;
});

async function startDaemon(): Promise<string> {
	stateDir = mkdtempSync(join(tmpdir(), "zodiacd-terminal-attach-"));
	daemon = spawn(process.execPath, [serviceCli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir], { stdio: ["ignore", "pipe", "pipe"] });
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

	it("a workspace created by a completely independent HTTP client against the same daemon appears live in the already-running terminal's own rendered screen", async () => {
		const url = await startDaemon();

		// Booted with *no* path argument -- the same "empty shell" walking-
		// skeleton state cli-bootstrap.pty.test.ts already exercises locally,
		// here against a fresh, still-empty attached daemon instead.
		// Deliberate: this TUI's own pillar/body regions only ever project a
		// *summary* of the World (layoutWorldRegions's own left pillar paints
		// items[0]'s own label, body paints workspaces[0]'s own title --
		// confirmed by reading semantic-shell.ts's own paintRegion) -- there is
		// no scrollable list of every open Workspace to render a *second*,
		// independently-created one into. A workspace created by an outside
		// client only becomes visible here if it's the *first* one the shared
		// World ever gets -- exactly the scenario a terminal attaching to an
		// already-shared, still-empty daemon produces, and still a real,
		// honest proof of the onChange -> refresh wiring against a real
		// running process (not just a fake fetcher in a unit test).
		terminal = spawnLiveTerminal(process.execPath, [cli, "--daemon", url], { cols: 80, rows: 24 });
		await terminal.waitForText("No workspace open", 15_000);

		const distinctiveTitle = "RemoteWS";
		const response = await fetch(`${url}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "remote-created", title: distinctiveTitle } }),
		});
		expect(response.ok).toBe(true);

		await terminal.waitForText(distinctiveTitle, 10_000);
		expect(terminal.snapshot()).not.toContain("No workspace open");
	}, 25_000);

	it("falls back to embedded mode -- and still boots normally -- when --daemon points at nothing reachable", async () => {
		workspaceDir = mkdtempSync(join(tmpdir(), "zodiac-terminal-attach-unreachable-"));
		writeFileSync(join(workspaceDir, "a.ts"), "export const a = 1;\n");
		const rootTitle = basename(workspaceDir);

		// Port 1 is a real, always-refused-connection target on any normal
		// machine (a genuinely privileged/unassigned port) -- no daemon needs
		// to be started at all for this case.
		terminal = spawnLiveTerminal(process.execPath, [cli, workspaceDir, "--daemon", "http://127.0.0.1:1"], { cols: 80, rows: 24 });
		await terminal.waitForText(rootTitle, 15_000);
		expect(terminal.rawOutput()).toContain("falling back to embedded mode");
	}, 20_000);
});
