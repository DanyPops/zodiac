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
 * "daily-drive" acceptance -- checklist item "Package discovery is bounded
 * and configuration-driven": Papyrus, Lector, Packed, and Pi each load from
 * their own package's explicit manifest (real proof for the two real
 * manifest shapes -- vehicle-surface, editor -- against fixture packages
 * here, not sibling-repo paths, per this session's own established
 * practice against path-dependent committed tests; the real Papyrus,
 * Lector, and Packed packages were separately verified live this session
 * against their own real, now-published package.json manifests). Zodiacd's
 * own source names none of them -- every definition comes from
 * --integration-package.
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

describe("daily-drive: Integration manifest discovery acceptance", () => {
	it("loads a task-management (vehicle-surface) package and a code-editing (editor, agent-invokable) package together, purely from their own manifests, with neither hardcoded", async () => {
		const vehicleHandleRoot = temporaryRoot("zodiac-daily-drive-manifest-vehicle-");
		const sharedEnv = {
			XDG_DATA_HOME: join(vehicleHandleRoot, "data"),
			XDG_STATE_HOME: join(vehicleHandleRoot, "state"),
			XDG_RUNTIME_DIR: join(vehicleHandleRoot, "run"),
			XDG_CONFIG_HOME: join(vehicleHandleRoot, "config"),
		};

		// A fixture task-management Vehicle, standing in for the real Papyrus.
		const registry = new VehicleRegistry({ name: "fixture-tasks", version: "1", description: "Fixture task-management Vehicle." });
		const operation = defineVehicleOperation({
			name: "tasks.list",
			version: 1,
			description: "Lists fixture tasks.",
			input: passthroughVehicleSchema,
			output: passthroughVehicleSchema,
			permissions: ["tasks:read"],
			effect: "read",
			idempotency: { mode: "safe" },
			limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 },
		});
		registry.register("tasks", bindVehicleOperation(operation, () => async () => [{ id: "task-1", title: "Fixture ready task", status: "todo" }]));
		const token = "fixture-tasks-token-0123456789";
		vehicleDaemon = await startVehicleDaemon({
			daemonLabel: "Fixture Tasks",
			handlePath: join(vehicleHandleRoot, "run", "fixture-tasks", "daemon.json"),
			buildApp: () => createVehicleHttpApp({ registry, token }),
			vehicleName: "fixture-tasks",
			tokenPath: join(vehicleHandleRoot, "fixture-tasks.token"),
			env: sharedEnv,
		});
		writeFileSync(join(vehicleHandleRoot, "fixture-tasks.token"), token);

		// A fixture code-editing (editor, agent-invokable) package, standing in for the real Lector.
		const editorPackageRoot = temporaryRoot("zodiac-daily-drive-manifest-editor-");
		writeFileSync(join(editorPackageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-editor",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] },
		}));
		writeFileSync(join(editorPackageRoot, "editor.mjs"), `export default {
			describe: () => ({ id: "fixture-editor", title: "Fixture Editor", commands: [{ id: "editor.file.save", title: "Save File" }], resourceSchemes: [], capabilities: ["agent-invokable"], contributionPoints: ["editor"] }),
			activate: (host) => { host.registerCommand({ id: "editor.file.save", title: "Save File", execute: async (input) => ({ ok: true, value: { uri: "fixture-editor://file/" + input.path, kind: "file", title: input.path, readOnly: false } }) }); },
			dispose: () => {},
		};\n`);

		// A fixture vehicle-surface package, standing in for the real Papyrus/Packed.
		const tasksPackageRoot = temporaryRoot("zodiac-daily-drive-manifest-tasks-");
		writeFileSync(join(tasksPackageRoot, "package.json"), JSON.stringify({
			name: "@fixture/daily-drive-tasks",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "vehicle-surface", vehicleName: "fixture-tasks", title: "Fixture Tasks" }] },
		}));

		const stateDir = temporaryRoot("zodiac-daily-drive-manifest-state-");
		const daemon = spawnManagedProcess({
			command: process.execPath,
			args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", join(editorPackageRoot, "package.json"), "--integration-package", join(tasksPackageRoot, "package.json")],
			env: sharedEnv,
		});
		daemons.push(daemon);
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		const baseUrl = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
		if (!baseUrl) throw new Error(`missing zodiacd URL in ${stdout}`);

		// Both loaded, neither zodiacd's own source names either by id.
		expect(stdout).toContain("loaded 2 configured Integration contribution(s)");
		expect(stdout).toContain("@fixture/daily-drive-editor/editor/fixture-editor");
		expect(stdout).toContain("@fixture/daily-drive-tasks/vehicle-surface/fixture-tasks");

		// The task-management surface is discoverable and real.
		const surfaces = await (await fetch(`${baseUrl}/api/vehicle-surfaces`)).json() as { surfaces: Array<{ id: string; title: string }> };
		expect(surfaces.surfaces).toEqual([{ id: "fixture-tasks", title: "Fixture Tasks" }]);
		const tasksInvoke = await (await fetch(`${baseUrl}/api/vehicle-surfaces/fixture-tasks/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "tasks.list", version: 1, input: {} }) })).json() as { ok: boolean; output: unknown };
		expect(tasksInvoke).toEqual({ ok: true, output: [{ id: "task-1", title: "Fixture ready task", status: "todo" }] });
		expect(JSON.stringify(tasksInvoke)).not.toContain(token);

		// The editor contribution is discoverable and its command is agent-invokable through the same daemon, at the same time --
		// alongside the vehicle-surface entry's own synthesized (commands: []) description, listed here too for uniform frontend labeling.
		const contributions = await (await fetch(`${baseUrl}/api/contributions`)).json() as { contributions: Array<{ id: string }> };
		expect(contributions.contributions.map((entry) => entry.id).sort()).toEqual(["fixture-editor", "fixture-tasks"]);
		const createWorkspace = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "workspace.create", workspaceId: "ws-daily-drive", title: "Daily Drive" } }) })).json() as { accepted: boolean };
		expect(createWorkspace.accepted).toBe(true);
		const dock = await (await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "surface.dock", workspaceId: "ws-daily-drive", integrationId: "fixture-editor", title: "Editor" } }) })).json() as { accepted: boolean };
		expect(dock.accepted).toBe(true);
		const invoke = await fetch(`${baseUrl}/api/world/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: { type: "integration.invoke", workspaceId: "ws-daily-drive", integrationId: "fixture-editor", action: "editor.file.save", input: { path: "src/a.ts" } } }) });
		const invokeBody = await invoke.json() as { accepted: boolean; result?: { invoke?: { ok: boolean; value?: { uri: string } } } };
		expect(invokeBody).toMatchObject({ accepted: true, result: { invoke: { ok: true, value: { uri: "fixture-editor://file/src/a.ts" } } } });
	}, 20_000);
});
