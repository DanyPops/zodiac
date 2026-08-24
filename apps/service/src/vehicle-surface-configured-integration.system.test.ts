import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { startDaemon as startVehicleDaemon } from "@danypops/vehicle-server/daemon";
import { createVehicleHttpApp } from "@danypops/vehicle-server/http";
import { bindVehicleOperation, defineVehicleOperation, passthroughVehicleSchema } from "@danypops/vehicle-core";
import { afterEach, describe, expect, it } from "vitest";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];
let vehicleDaemon: Awaited<ReturnType<typeof startVehicleDaemon>> | undefined;

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
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

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	await vehicleDaemon?.stop();
	vehicleDaemon = undefined;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Real proof of the declarative vehicle-surface configured-Integration
 * mechanism (task "Wire Jittor as Zodiac's canonical live token/cost/
 * context meter"), against a minimal fixture Vehicle daemon rather than a
 * hardcoded path into the sibling Jittor repo -- a committed test must stay
 * portable and fast; the real Jittor integration was verified separately
 * (Jittor's own daemon.ts now passes vehicleName/tokenPath into this exact
 * shared startDaemon, proven by that repo's own daemon.test.ts).
 */
describe("zodiacd: package-owned vehicle-surface configured Integration", () => {
	it("discovers a real Vehicle daemon purely by name, with no hardcoded definition in zodiacd's own source, and proxies its manifest/invoke without ever leaking its token", async () => {
		// Two real spawned processes (a fixture Vehicle daemon, then zodiacd) --
		// the default 5s test timeout is genuinely too tight when the full suite
		// runs in parallel under real sandbox resource contention (the same
		// established class of flake this session's own daemon-handle.test.ts/
		// configured-integrations.system.test.ts already accept).
		const vehicleHandleRoot = temporaryRoot("zodiac-vehicle-surface-fixture-vehicle-");
		const sharedEnv = {
			XDG_DATA_HOME: join(vehicleHandleRoot, "data"),
			XDG_STATE_HOME: join(vehicleHandleRoot, "state"),
			XDG_RUNTIME_DIR: join(vehicleHandleRoot, "run"),
			XDG_CONFIG_HOME: join(vehicleHandleRoot, "config"),
		};

		// A real, minimal Vehicle daemon -- the exact same daemon-kit
		// (startDaemon) and HTTP composition (createVehicleHttpApp) Jittor's
		// own real daemon uses, not a hand-rolled fake.
		const registry = new VehicleRegistry({ name: "fixture-vehicle", version: "1", description: "Fixture Vehicle for the vehicle-surface configured-Integration proof." });
		const operation = defineVehicleOperation({
			name: "fixture.echo",
			version: 1,
			description: "Echoes its own input.",
			input: passthroughVehicleSchema,
			output: passthroughVehicleSchema,
			permissions: ["fixture:read"],
			effect: "read",
			idempotency: { mode: "safe" },
			limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 },
		});
		registry.register("fixture", bindVehicleOperation(operation, () => async (context) => context.input));
		const token = "fixture-vehicle-token-0123456789";
		vehicleDaemon = await startVehicleDaemon({
			daemonLabel: "Fixture Vehicle",
			handlePath: join(vehicleHandleRoot, "run", "fixture-vehicle", "daemon.json"),
			buildApp: () => createVehicleHttpApp({ registry, token }),
			vehicleName: "fixture-vehicle",
			tokenPath: join(vehicleHandleRoot, "fixture-vehicle.token"),
			env: sharedEnv,
		});
		writeFileSync(join(vehicleHandleRoot, "fixture-vehicle.token"), token);

		const packageRoot = temporaryRoot("zodiac-configured-vehicle-surface-");
		const stateDir = temporaryRoot("zodiac-configured-vehicle-surface-state-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/zodiac-fixture-vehicle",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-surface", vehicleName: "fixture-vehicle", title: "Fixture Vehicle" }] },
		}));

		// zodiacd's own vehicle-surface discovery reads the SAME shared Vehicle
		// Handle Directory the fixture Vehicle daemon above just published
		// into -- both must agree on the same XDG env for that discovery to
		// find it at all.
		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"), sharedEnv);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);
		expect(stdout).toContain("loaded 1 configured Integration contribution");
		expect(stdout).toContain("@fixture/zodiac-fixture-vehicle/vehicle-surface/fixture-vehicle");

		const list = await (await fetch(`${baseUrl}/api/vehicle-surfaces`)).json() as { surfaces: Array<{ id: string; title: string }> };
		// No hardcoded Papyrus entry anymore -- Papyrus is now purely a
		// package-owned vehicle-surface configured Integration itself (its own
		// package.json's zodiac.integrations field), the identical mechanism
		// this fixture proves; with no Papyrus package configured here, only
		// the fixture Vehicle this test itself configured is discoverable.
		expect(list.surfaces).toEqual([{ id: "fixture-vehicle", title: "Fixture Vehicle" }]);

		const manifestResponse = await fetch(`${baseUrl}/api/vehicle-surfaces/fixture-vehicle/manifest`);
		expect(manifestResponse.status).toBe(200);
		const manifest = await manifestResponse.json() as { operations: Array<{ name: string }> };
		expect(manifest.operations.map((entry) => entry.name)).toEqual(["fixture.echo"]);
		// Never the bearer token or the fixture Vehicle's own daemon baseUrl -- only the
		// projected, safe manifest shape.
		expect(JSON.stringify(manifest)).not.toContain(token);

		const invokeResponse = await fetch(`${baseUrl}/api/vehicle-surfaces/fixture-vehicle/invoke`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "fixture.echo", version: 1, input: { hello: "world" } }),
		});
		expect(invokeResponse.status).toBe(200);
		const invoked = await invokeResponse.json() as { ok: boolean; output: unknown };
		expect(invoked).toMatchObject({ ok: true, output: { hello: "world" } });
		expect(JSON.stringify(invoked)).not.toContain(token);
	}, 20_000);
});
