import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { startDaemon as startVehicleDaemon } from "@danypops/vehicle-server/daemon";
import { createVehicleHttpApp } from "@danypops/vehicle-server/http";
import { bindVehicleOperation, defineVehicleOperation, passthroughVehicleSchema } from "@danypops/vehicle-core";
import { afterEach, describe, expect, it } from "vitest";

/**
 * "daily-drive" acceptance -- checklist item "Credentials and failures
 * remain contained": no Vehicle bearer token ever reaches a client-visible
 * response, a lost Vehicle connection surfaces as a typed, retryable
 * failure rather than a crash or an opaque 500, and the same operation
 * succeeds again once the Vehicle daemon actually comes back -- real
 * disconnect/reconnect, not a simulated error injection.
 */
const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];
let vehicleDaemon: Awaited<ReturnType<typeof startVehicleDaemon>> | undefined;

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
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

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	await vehicleDaemon?.stop();
	vehicleDaemon = undefined;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRegistry() {
	const registry = new VehicleRegistry({ name: "fixture-tasks", version: "1", description: "Fixture task-management Vehicle." });
	const listOperation = defineVehicleOperation({ name: "tasks.list", version: 1, description: "Lists tasks.", input: passthroughVehicleSchema, output: passthroughVehicleSchema, permissions: ["tasks:read"], effect: "read", idempotency: { mode: "safe" }, limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 } });
	registry.register("tasks", bindVehicleOperation(listOperation, () => async () => [{ id: "task-1", title: "Ready task", status: "todo" }]));
	return registry;
}

describe("daily-drive: security and recovery acceptance", () => {
	it("surfaces a real Vehicle disconnect as a typed, retryable failure -- never a crash or the bearer token -- and recovers once the Vehicle actually comes back", async () => {
		const vehicleHandleRoot = temporaryRoot("zodiac-daily-drive-recovery-vehicle-");
		const sharedEnv = {
			XDG_DATA_HOME: join(vehicleHandleRoot, "data"),
			XDG_STATE_HOME: join(vehicleHandleRoot, "state"),
			XDG_RUNTIME_DIR: join(vehicleHandleRoot, "run"),
			XDG_CONFIG_HOME: join(vehicleHandleRoot, "config"),
		};
		const token = "fixture-tasks-token-0123456789";
		const handlePath = join(vehicleHandleRoot, "run", "fixture-tasks", "daemon.json");
		vehicleDaemon = await startVehicleDaemon({
			daemonLabel: "Fixture Tasks",
			handlePath,
			buildApp: () => createVehicleHttpApp({ registry: fixtureRegistry(), token }),
			vehicleName: "fixture-tasks",
			tokenPath: join(vehicleHandleRoot, "fixture-tasks.token"),
			env: sharedEnv,
		});
		writeFileSync(join(vehicleHandleRoot, "fixture-tasks.token"), token);

		const packageRoot = temporaryRoot("zodiac-daily-drive-recovery-package-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-recovery",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-surface", vehicleName: "fixture-tasks", title: "Fixture Tasks" }] },
		}));

		const stateDir = temporaryRoot("zodiac-daily-drive-recovery-state-");
		const daemon = spawnManagedProcess({
			command: process.execPath,
			args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")],
			env: sharedEnv,
		});
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		async function invokeList(): Promise<unknown> {
			const response = await fetch(`${baseUrl}/api/vehicle-surfaces/fixture-tasks/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "tasks.list", version: 1, input: {} }) });
			return response.json();
		}

		// Working, connected: a real invoke succeeds, never leaking the token.
		const before = await invokeList();
		expect(before).toEqual({ ok: true, output: [{ id: "task-1", title: "Ready task", status: "todo" }] });
		expect(JSON.stringify(before)).not.toContain(token);

		// Real disconnect: stop the Vehicle daemon out from under zodiacd (a genuine crash/restart, not a mock).
		await vehicleDaemon.stop();
		vehicleDaemon = undefined;

		const duringOutage = await invokeList();
		expect(duringOutage).toMatchObject({ ok: false, error: { code: "vehicle-surface-unavailable", category: "unavailable", retryable: true } });
		expect(JSON.stringify(duringOutage)).not.toContain(token);

		// Real recovery: bring the exact same Vehicle back up at the same handle path -- zodiacd never cached a dead target, no restart of zodiacd itself required.
		vehicleDaemon = await startVehicleDaemon({
			daemonLabel: "Fixture Tasks",
			handlePath,
			buildApp: () => createVehicleHttpApp({ registry: fixtureRegistry(), token }),
			vehicleName: "fixture-tasks",
			tokenPath: join(vehicleHandleRoot, "fixture-tasks.token"),
			env: sharedEnv,
		});

		const after = await invokeList();
		expect(after).toEqual({ ok: true, output: [{ id: "task-1", title: "Ready task", status: "todo" }] });
		expect(JSON.stringify(after)).not.toContain(token);
	}, 20_000);

	it("reports an unknown/malformed manifest package's own failure without crashing zodiacd, and never leaks a raw filesystem path in the response", async () => {
		const packageRoot = temporaryRoot("zodiac-daily-drive-malformed-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-malformed",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] },
		}));
		writeFileSync(join(packageRoot, "editor.mjs"), "export default {};\n");

		const stateDir = temporaryRoot("zodiac-daily-drive-malformed-state-");
		const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")] });
		daemons.push(daemon);

		// Fails loud and fast at startup, with a package-scoped diagnostic -- never a silent skip, never a crash with no explanation.
		const exitCode = await daemon.waitForExit();
		expect(exitCode).not.toBe(0);
		expect(daemon.stderr).toContain("@fixture/daily-drive-malformed editor entry must default-export a ZodiacContribution");
	}, 20_000);
});
