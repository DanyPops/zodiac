import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The acceptance criterion this task's own body names directly: "At least
 * one currently-first-party contribution (Papyrus, Lector, Packed, or Pi)
 * is demonstrated running through the real boundary defined here, not
 * just a synthetic fixture." Papyrus is already a real, published,
 * Vehicle-shaped daemon with its own "serve" launch mode -- zero changes
 * to Papyrus's own source were needed; it already satisfies the
 * vehicle-loopback contract (a spawnable entry booting a real Vehicle
 * daemon over an authenticated loopback) by construction. This spawns a
 * genuinely separate, fully isolated Papyrus instance (its own XDG_* env,
 * its own empty task database) -- never the real, currently-in-use
 * production Papyrus daemon this very session's own tooling depends on.
 */
const papyrusPackageRoot = "/home/dpopsuev/.cache/.bun/install/global/node_modules/@danypops/papyrus";
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function isolatedEnv(root: string): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "",
		XDG_DATA_HOME: join(root, "data"),
		XDG_STATE_HOME: join(root, "state"),
		XDG_RUNTIME_DIR: join(root, "run"),
		XDG_CONFIG_HOME: join(root, "config"),
	};
}

async function waitForStdout(process: ManagedProcess, pattern: RegExp, timeoutMs = 20_000): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		const unsubscribe = process.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			if (pattern.test(stdout)) {
				unsubscribe();
				resolve(stdout);
			}
		});
		void process.waitForExit().then((code) => reject(new Error(`zodiacd exited (${code}) before ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)));
		setTimeout(() => reject(new Error(`timed out waiting for ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)), timeoutMs);
	});
}

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!existsSync(papyrusPackageRoot))("vehicle-loopback boundary against a real, currently-published first-party package", () => {
	it("zodiacd spawns the real @danypops/papyrus package's own \"serve\" entry as a genuine child process -- no fixture, no Papyrus source changes", async () => {
		const isolationRoot = temporaryRoot("zodiac-vlb-papyrus-isolation-");
		const env = isolatedEnv(isolationRoot);
		// The manifest's own entry-containment check requires `entry` to resolve inside the
		// declaring package's own root -- since this test intentionally does not (and must not)
		// modify the real, globally-installed @danypops/papyrus package.json, a scratch package
		// symlinking Papyrus's own real `src/` directory in is what lets a manifest legitimately
		// name that real code without copying it. bun (this manifest's own declared `command`)
		// transparently dereferences the symlink when it actually runs the entry -- the process
		// that boots is Papyrus's own real cli.ts, unmodified.
		const packageRoot = temporaryRoot("zodiac-vlb-papyrus-package-");
		symlinkSync(join(papyrusPackageRoot, "src"), join(packageRoot, "src"));
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/real-papyrus-vehicle-loopback",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-loopback", vehicleName: "papyrus", title: "Papyrus", command: "bun", entry: "./src/cli.ts", args: ["serve"] }] },
		}));

		const stateDir = temporaryRoot("zodiac-vlb-papyrus-state-");
		const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")], env });
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);
		// Confirms the real spawn+connect succeeded before this test's own commands run --
		// the same "loaded N configured Integration contribution(s)" line every other
		// configured-loader case already relies on.
		expect(stdout).toContain("papyrus");

		const create = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-papyrus", title: "Coding" } }) })).json() as { accepted: boolean };
		expect(create.accepted).toBe(true);
		const dock = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-papyrus", integrationId: "papyrus", title: "Papyrus" } }) })).json() as { accepted: boolean };
		expect(dock.accepted).toBe(true);

		// A real Papyrus read operation, against this test's own genuinely empty,
		// fully isolated task database -- never the live production one.
		// tasks.list itself requires project_root (see Papyrus's own handlers/tasks.ts).
		const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-papyrus", integrationId: "papyrus", action: "tasks.list", input: { project_root: packageRoot } } }) });
		const body = await response.json() as { accepted: boolean; result?: { invoke?: { ok: boolean; value?: unknown } } };

		expect(response.status).toBe(200);
		expect(body.accepted).toBe(true);
		expect(body.result?.invoke?.ok).toBe(true);
		expect(Array.isArray(body.result?.invoke?.value)).toBe(true);
		// Real Vehicle credentials never leak into a client-visible response, matching
		// every other Vehicle-backed transport this project already holds to that bar.
		expect(JSON.stringify(body)).not.toMatch(/[a-f0-9]{64}/);
	}, 30_000);
});
