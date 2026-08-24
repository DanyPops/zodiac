import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VEHICLE_LOOPBACK_CONTRIBUTION_POINT, type ContributionCommand, type ContributionResourceProvider } from "@zodiac/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createContributionPointRegistry } from "./point-registry.js";
import { createVehicleLoopbackExecutionStrategy, VehicleLoopbackActivationError, type VehicleLoopbackSpawnSpec } from "./vehicle-loopback-execution-strategy.js";

/**
 * Real end-to-end proof of this task's own acceptance criteria: a
 * genuinely spawned, out-of-process Vehicle-shaped subprocess (not an
 * in-process stand-in) contributes real commands through the same
 * ContributionHost an in-process "editor" contribution would use, and a
 * deliberate crash or hang in that subprocess surfaces as a bounded,
 * typed ContributionOutcome failure rather than corrupting or hanging the
 * host.
 */
const fixtureEntry = fileURLToPath(new URL("./fixtures/vehicle-loopback-fixture.mjs", import.meta.url));

interface PlatformPoints {
	"vehicle-loopback": { readonly id: string };
}

const roots: string[] = [];

function isolatedEnv(): Record<string, string> {
	const root = mkdtempSync(join(tmpdir(), "zodiac-vehicle-loopback-"));
	roots.push(root);
	return {
		PATH: process.env.PATH ?? "",
		XDG_DATA_HOME: join(root, "data"),
		XDG_STATE_HOME: join(root, "state"),
		XDG_RUNTIME_DIR: join(root, "run"),
		XDG_CONFIG_HOME: join(root, "config"),
	};
}

// Spawned via bun, not plain node: @danypops/vehicle-server ships raw
// TypeScript source with no compiled dist, and Node's own type-stripping
// support explicitly refuses to run a .ts file located under
// node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) -- exactly
// the documented Node/Bun boundary this fixture's own real dependency
// hits. A real vehicle-loopback package author declares whichever
// command ("bun" here, matching every other first-party Vehicle daemon
// in this ecosystem) their own entry actually needs; the manifest's own
// `command` field exists precisely so this isn't hardcoded into zodiacd.
function spawnSpec(vehicleName: string, mode: string | undefined, env: Record<string, string>): VehicleLoopbackSpawnSpec {
	return {
		command: "bun",
		args: [fixtureEntry],
		cwd: process.cwd(),
		env: { ...env, VEHICLE_LOOPBACK_FIXTURE_NAME: vehicleName, ...(mode ? { VEHICLE_LOOPBACK_FIXTURE_MODE: mode } : {}) },
	};
}

function testHost() {
	const commands = new Map<string, ContributionCommand>();
	const providers = new Map<string, ContributionResourceProvider>();
	return {
		commands,
		providers,
		host: {
			registerCommand(command: ContributionCommand) {
				commands.set(command.id, command);
				return () => commands.delete(command.id);
			},
			registerResourceProvider(provider: ContributionResourceProvider) {
				providers.set(provider.scheme, provider);
				return () => providers.delete(provider.scheme);
			},
		},
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("createVehicleLoopbackExecutionStrategy", () => {
	it("activates a real, genuinely spawned subprocess and projects its manifest into ordinary ContributionCommands", async () => {
		const env = isolatedEnv();
		const registry = createContributionPointRegistry<PlatformPoints>([VEHICLE_LOOPBACK_CONTRIBUTION_POINT]);
		const { commands, host } = testHost();
		const strategy = createVehicleLoopbackExecutionStrategy(registry, host, { readyTimeoutMs: 15_000 });

		const active = await strategy.activate("fixture-vehicle", "Fixture Vehicle", spawnSpec("fixture-vehicle", undefined, env), { packageId: "@fixture/vehicle-loopback", version: "1.0.0", source: "test" });
		try {
			expect(active.description.commands).toEqual([{ id: "fixture.echo", title: "fixture.echo" }]);
			expect(active.description.capabilities).toEqual(["agent-invokable"]);
			expect(registry.entries("vehicle-loopback")).toHaveLength(1);

			const command = commands.get("fixture.echo");
			expect(command).toBeDefined();
			const outcome = await command!.execute({ hello: "world" });
			expect(outcome).toEqual({ ok: true, value: { hello: "world" } });
		} finally {
			await active.dispose();
		}

		// dispose() really tore everything down -- the command is gone and the point registry is empty.
		expect(commands.has("fixture.echo")).toBe(false);
		expect(registry.entries("vehicle-loopback")).toHaveLength(0);
	}, 20_000);

	it("a deliberately crashing subprocess reports a bounded, typed failure -- never an unhandled exception -- and the host stays usable", async () => {
		const env = isolatedEnv();
		const registry = createContributionPointRegistry<PlatformPoints>([VEHICLE_LOOPBACK_CONTRIBUTION_POINT]);
		const { commands, host } = testHost();
		const strategy = createVehicleLoopbackExecutionStrategy(registry, host, { readyTimeoutMs: 15_000, invokeTimeoutMs: 2_000 });

		const active = await strategy.activate("crash-vehicle", "Crash Vehicle", spawnSpec("crash-vehicle", "crash-after-ready", env), { packageId: "@fixture/vehicle-loopback", version: "1.0.0", source: "test" });
		try {
			// Let the fixture's own scheduled process.exit(1) actually happen.
			await new Promise((resolve) => setTimeout(resolve, 600));
			const command = commands.get("fixture.echo")!;
			const outcome = await command.execute({});
			expect(outcome.ok).toBe(false);
			if (!outcome.ok) expect(outcome.code).toMatch(/vehicle-loopback|unavailable/);
		} finally {
			await active.dispose();
		}
	}, 20_000);

	it("a deliberately hanging subprocess is bounded by invokeTimeoutMs -- never hangs the caller", async () => {
		const env = isolatedEnv();
		const registry = createContributionPointRegistry<PlatformPoints>([VEHICLE_LOOPBACK_CONTRIBUTION_POINT]);
		const { commands, host } = testHost();
		const strategy = createVehicleLoopbackExecutionStrategy(registry, host, { readyTimeoutMs: 15_000, invokeTimeoutMs: 500 });

		const active = await strategy.activate("hang-vehicle", "Hang Vehicle", spawnSpec("hang-vehicle", "hang", env), { packageId: "@fixture/vehicle-loopback", version: "1.0.0", source: "test" });
		try {
			const command = commands.get("fixture.echo")!;
			const started = Date.now();
			const outcome = await command.execute({});
			const elapsedMs = Date.now() - started;
			expect(outcome).toEqual({ ok: false, code: "vehicle-loopback-timeout", message: expect.stringContaining("fixture.echo") });
			expect(elapsedMs).toBeLessThan(5_000);
		} finally {
			await active.dispose();
		}
	}, 20_000);

	it("throws VehicleLoopbackActivationError -- never leaves a half-registered point -- when the spawned process never becomes ready", async () => {
		const env = isolatedEnv();
		const registry = createContributionPointRegistry<PlatformPoints>([VEHICLE_LOOPBACK_CONTRIBUTION_POINT]);
		const { host } = testHost();
		const strategy = createVehicleLoopbackExecutionStrategy(registry, host, { readyTimeoutMs: 500 });

		await expect(strategy.activate("nonexistent-vehicle", "Nonexistent", { command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], cwd: process.cwd(), env }, { packageId: "@fixture/vehicle-loopback", version: "1.0.0", source: "test" })).rejects.toThrow(VehicleLoopbackActivationError);
		expect(registry.entries("vehicle-loopback")).toHaveLength(0);
	}, 10_000);
});
