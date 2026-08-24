import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The end-to-end proof for "Contributions: move from in-process trust to a
 * real process/trust boundary (Vehicle-shaped authenticated loopback)": a
 * real spawned zodiacd loads a package declaring a `vehicle-loopback`
 * contribution -- zodiacd itself spawns that contribution's own entry as a
 * genuine second child process (never imports it in-process), connects
 * over an authenticated Vehicle loopback, and projects its commands into
 * the exact same `integration.invoke` dispatch path an in-process "editor"
 * contribution uses -- no special-casing by transport. A deliberately
 * crashing out-of-process contribution demonstrates zodiacd itself staying
 * up and reporting a bounded, typed failure.
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const fixtureEntry = fileURLToPath(new URL("./fixtures/vehicle-loopback-fixture.mjs", import.meta.url));
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function isolatedEnv(): Record<string, string> {
	const root = temporaryRoot("zodiac-vehicle-loopback-env-");
	return {
		PATH: process.env.PATH ?? "",
		XDG_DATA_HOME: join(root, "data"),
		XDG_STATE_HOME: join(root, "state"),
		XDG_RUNTIME_DIR: join(root, "run"),
		XDG_CONFIG_HOME: join(root, "config"),
	};
}

function spawnZodiacd(stateDir: string, packageJsonPath: string, env: Record<string, string>): ManagedProcess {
	const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", packageJsonPath], env });
	daemons.push(daemon);
	return daemon;
}

async function waitForStdout(process: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
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

function writeFixturePackage(packageRoot: string, vehicleName: string): void {
	copyFileSync(fixtureEntry, join(packageRoot, "vehicle-loopback-fixture.mjs"));
	writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
		name: "@fixture/vehicle-loopback-contribution",
		version: "1.0.0",
		zodiac: { integrations: [{ kind: "vehicle-loopback", vehicleName, title: "Fixture Vehicle Loopback", command: "bun", entry: "./vehicle-loopback-fixture.mjs" }] },
	}));
}

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("integration.invoke reaches a real out-of-process vehicle-loopback contribution", () => {
	it("zodiacd spawns the contribution's own entry as a genuine second process and dispatches a real command to it over the authenticated loopback", async () => {
		const env = isolatedEnv();
		const packageRoot = temporaryRoot("zodiac-vehicle-loopback-package-");
		const stateDir = temporaryRoot("zodiac-vehicle-loopback-state-");
		writeFixturePackage(packageRoot, "fixture-loopback-vehicle");

		// zodiacd's own vehicle-loopback strategy passes no explicit env override when it spawns a
		// contribution's entry (see configured-loader.ts) -- the child simply inherits zodiacd's own
		// env, the same channel a real deployment would use for spawn-time configuration. This
		// fixture accepts its own name via env purely so one fixture file covers multiple vehicle
		// names across this suite (a real Papyrus/Jittor/Packed-style contribution would instead
		// hardcode its own name, matching its own manifest entry by simple convention).
		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"), { ...env, VEHICLE_LOOPBACK_FIXTURE_NAME: "fixture-loopback-vehicle" });
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		const create = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-vlb", title: "Coding" } }) })).json() as { accepted: boolean };
		expect(create.accepted).toBe(true);
		const dock = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-vlb", integrationId: "fixture-loopback-vehicle", title: "Fixture Vehicle Loopback" } }) })).json() as { accepted: boolean };
		expect(dock.accepted).toBe(true);

		const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-vlb", integrationId: "fixture-loopback-vehicle", action: "fixture.echo", input: { hello: "world" } } }) });
		const body = await response.json() as { accepted: boolean; result?: { invoke?: { ok: boolean; value?: unknown } } };

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ accepted: true, result: { invoke: { ok: true, value: { hello: "world" } } } });
	}, 25_000);

	it("a deliberately crashing out-of-process contribution reports a bounded, typed failure -- zodiacd itself stays up and keeps serving other requests", async () => {
		const env = isolatedEnv();
		const packageRoot = temporaryRoot("zodiac-vehicle-loopback-crash-package-");
		const stateDir = temporaryRoot("zodiac-vehicle-loopback-crash-state-");
		copyFileSync(fixtureEntry, join(packageRoot, "vehicle-loopback-fixture.mjs"));
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/vehicle-loopback-crash",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-loopback", vehicleName: "crash-loopback-vehicle", title: "Crash Fixture", command: "bun", entry: "./vehicle-loopback-fixture.mjs" }] },
		}));

		const daemon = spawnManagedProcess({
			command: process.execPath,
			args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")],
			env: { ...env, VEHICLE_LOOPBACK_FIXTURE_NAME: "crash-loopback-vehicle", VEHICLE_LOOPBACK_FIXTURE_MODE: "crash-after-ready" },
		});
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-crash", title: "Coding" } }) })).json();
		await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-crash", integrationId: "crash-loopback-vehicle", title: "Crash Fixture" } }) })).json();

		// Let the fixture's own scheduled process.exit(1) actually happen.
		await new Promise((resolve) => setTimeout(resolve, 700));

		const response = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-crash", integrationId: "crash-loopback-vehicle", action: "fixture.echo", input: {} } }) });
		const body = await response.json() as { result?: { invoke?: { ok: boolean } } };
		expect(body.result?.invoke?.ok).toBe(false);

		// zodiacd itself is still alive and serving -- the crash never propagated.
		expect(daemon.hasExited).toBe(false);
		const health = await fetch(`${baseUrl}/api/world`);
		expect(health.status).toBe(200);
	}, 25_000);
});
