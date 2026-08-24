import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { startDaemon as startVehicleDaemon } from "@danypops/vehicle-server/daemon";
import { createVehicleHttpApp } from "@danypops/vehicle-server/http";
import { bindVehicleOperation, defineVehicleOperation, passthroughVehicleSchema } from "@danypops/vehicle-core";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

/**
 * "daily-drive" acceptance -- checklist item "Papyrus lifecycle is
 * completed inside Zodiac": a real ready task is inspected, started,
 * submitted, and completed purely through zodiacd's own Vehicle Surface
 * Gateway (the identical HTTP path VehicleSurfaceContent's own
 * client.invoke calls), against a fixture task-management Vehicle
 * (real tasks.list/start/submit/complete operation names/effects,
 * matching Papyrus's own real shape) rather than the real Papyrus daemon
 * (a committed test must stay portable and fast; the real Papyrus
 * Integration was verified separately, live, this session).
 *
 * "Live status projection" itself -- the push-invalidation refresh -- is
 * proven separately at two other layers, deliberately not re-proven here:
 * vehicle-surface-gateway.test.ts's own "subscribes once to every declared
 * event and forwards reconnect state" (the daemon-side relay), and
 * VehicleSurface.test.tsx's own "refreshes the active view from push
 * invalidation instead of polling" (the component's own reaction). This
 * test's own job is the lifecycle sequence itself actually landing at
 * each step, end to end.
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

describe("daily-drive: Papyrus task acceptance", () => {
	it("inspects, starts, submits, and completes a real ready task purely through zodiacd's Vehicle Surface Gateway", async () => {
		const vehicleHandleRoot = temporaryRoot("zodiac-daily-drive-papyrus-vehicle-");
		const sharedEnv = {
			XDG_DATA_HOME: join(vehicleHandleRoot, "data"),
			XDG_STATE_HOME: join(vehicleHandleRoot, "state"),
			XDG_RUNTIME_DIR: join(vehicleHandleRoot, "run"),
			XDG_CONFIG_HOME: join(vehicleHandleRoot, "config"),
		};

		const tasks = new Map<string, { id: string; title: string; status: string }>([["task-1", { id: "task-1", title: "Fix the daily-drive gap", status: "todo" }]]);
		function requireTask(id: string): { id: string; title: string; status: string } {
			const task = tasks.get(id);
			if (!task) throw new Error(`no such task: ${id}`);
			return task;
		}
				const registry = new VehicleRegistry({ name: "fixture-papyrus", version: "1", description: "Fixture Papyrus-shaped task-management Vehicle." });
		const listOperation = defineVehicleOperation({ name: "tasks.list", version: 1, description: "Lists tasks.", input: passthroughVehicleSchema, output: passthroughVehicleSchema, permissions: ["tasks:read"], effect: "read", idempotency: { mode: "safe" }, limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 } });
		const startOperation = defineVehicleOperation({ name: "tasks.start", version: 1, description: "Starts a task.", input: passthroughVehicleSchema, output: passthroughVehicleSchema, permissions: ["tasks:write"], effect: "local-write", idempotency: { mode: "safe" }, limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 } });
		const submitOperation = defineVehicleOperation({ name: "tasks.submit", version: 1, description: "Submits a task for review.", input: passthroughVehicleSchema, output: passthroughVehicleSchema, permissions: ["tasks:write"], effect: "local-write", idempotency: { mode: "safe" }, limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 } });
		const completeOperation = defineVehicleOperation({ name: "tasks.complete", version: 1, description: "Completes a reviewed task.", input: passthroughVehicleSchema, output: passthroughVehicleSchema, permissions: ["tasks:write"], effect: "local-write", idempotency: { mode: "safe" }, limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 } });
		registry.register("tasks", bindVehicleOperation(listOperation, () => async () => [...tasks.values()]));
		registry.register("tasks", bindVehicleOperation(startOperation, () => async (context) => { const task = requireTask((context.input as { id: string }).id); task.status = "in-progress"; return { id: task.id, status: task.status }; }));
		registry.register("tasks", bindVehicleOperation(submitOperation, () => async (context) => { const task = requireTask((context.input as { id: string }).id); task.status = "review"; return { id: task.id, status: task.status }; }));
		registry.register("tasks", bindVehicleOperation(completeOperation, () => async (context) => { const task = requireTask((context.input as { id: string }).id); task.status = "done"; return { id: task.id, status: task.status }; }));

		const token = "fixture-papyrus-token-0123456789";
		vehicleDaemon = await startVehicleDaemon({
			daemonLabel: "Fixture Papyrus",
			handlePath: join(vehicleHandleRoot, "run", "fixture-papyrus", "daemon.json"),
			buildApp: () => createVehicleHttpApp({ registry, token }),
			vehicleName: "fixture-papyrus",
			tokenPath: join(vehicleHandleRoot, "fixture-papyrus.token"),
			env: sharedEnv,
		});
		writeFileSync(join(vehicleHandleRoot, "fixture-papyrus.token"), token);

		const packageRoot = temporaryRoot("zodiac-daily-drive-papyrus-package-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-papyrus",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-surface", vehicleName: "fixture-papyrus", title: "Fixture Papyrus" }] },
		}));

		const stateDir = temporaryRoot("zodiac-daily-drive-papyrus-state-");
		const daemon = spawnManagedProcess({
			command: process.execPath,
			args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(packageRoot, "package.json")],
			env: sharedEnv,
		});
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		async function invoke(name: string, input: unknown): Promise<{ ok: boolean; output: unknown }> {
			const response = await fetch(`${baseUrl}/api/vehicle-surfaces/fixture-papyrus/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, version: 1, input }) });
			return response.json() as Promise<{ ok: boolean; output: unknown }>;
		}

		// Inspect: a real ready task is listed, status todo.
		const inspected = await invoke("tasks.list", {});
		expect(inspected).toMatchObject({ ok: true, output: [{ id: "task-1", title: "Fix the daily-drive gap", status: "todo" }] });

		// Start: todo -> in-progress.
		const started = await invoke("tasks.start", { id: "task-1" });
		expect(started).toEqual({ ok: true, output: { id: "task-1", status: "in-progress" } });

		// Submit: in-progress -> review.
		const submitted = await invoke("tasks.submit", { id: "task-1" });
		expect(submitted).toEqual({ ok: true, output: { id: "task-1", status: "review" } });

		// Complete: review -> done.
		const completed = await invoke("tasks.complete", { id: "task-1" });
		expect(completed).toEqual({ ok: true, output: { id: "task-1", status: "done" } });

		// A fresh list reflects the final state -- the same re-fetch VehicleSurfaceContent's
		// own live-invalidation handler performs after every push event.
		const after = await invoke("tasks.list", {});
		expect(after).toMatchObject({ ok: true, output: [{ id: "task-1", status: "done" }] });

		// Never the bearer token, at any step.
		for (const outcome of [inspected, started, submitted, completed, after]) expect(JSON.stringify(outcome)).not.toContain(token);
	}, 20_000);
});
