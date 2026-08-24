/**
 * Executes a code-bearing contribution out-of-process, over the same
 * authenticated Vehicle loopback transport every other Vehicle daemon in
 * this ecosystem uses (Papyrus/Jittor/Packed) -- the real process/trust
 * boundary a plain in-process "editor" contribution's `createInProcessExecutionStrategy`
 * does not have. zodiacd spawns the contribution's own declared entry as a
 * genuine child process, waits for it to publish a live handle into the
 * shared Vehicle Handle Directory, connects, and projects its manifest's
 * operations into ordinary ContributionCommand objects registered into the
 * exact same ContributionHost an in-process contribution would use --
 * `integration.invoke`, the HTTP invoke route, and tool-grant loading all
 * treat the result identically, with no special-casing for how a
 * contribution's own commands actually run.
 *
 * A crash or hang in the spawned process can only ever surface as a failed
 * or bounded-timeout ContributionOutcome from one command's own execute()
 * call -- never an unhandled exception or a stall in zodiacd's own World/
 * dispatcher, since every invocation is a real network round trip this
 * strategy independently bounds with its own deadline, and the spawned
 * process's own lifecycle is fully isolated from this one.
 */
import type { VehicleInvocationOptions, VehicleManifest } from "@danypops/vehicle-core";
import { isVehicleError } from "@danypops/vehicle-core";
import { RemoteVehicleClient } from "@danypops/vehicle-client/http";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { LOOPBACK_HOST, readDaemonHandle, resolveSharedVehicleHandlePath } from "@danypops/vehicle-server/paths";
import type { ContributionCommand, ContributionDescription, ContributionHost, ContributionOutcome, ContributionProvenance } from "@zodiac/protocol";
import type { ActiveContribution } from "./execution-strategy.js";
import { resolveSharedVehicleTarget, type VehicleSurfaceTarget } from "../vehicle/vehicle-surface-gateway.js";

// A real Vehicle daemon's own first-run boot (schema migrations, config resolution) can
// genuinely take longer than a synthetic fixture's near-instant startup, especially under
// concurrent load -- confirmed live spawning the real @danypops/papyrus package. 20s matches
// this codebase's own convention for a real zodiacd boot wait elsewhere in this suite, not an
// arbitrarily large number.
export const DEFAULT_VEHICLE_LOOPBACK_READY_TIMEOUT_MS = 20_000;
export const DEFAULT_VEHICLE_LOOPBACK_INVOKE_TIMEOUT_MS = 10_000;

export interface VehicleLoopbackSpawnSpec {
	readonly command: string;
	/** Full argv after `command`, e.g. [absoluteEntryPath, ...extraArgs] -- already resolved/validated by the caller (configured-loader.ts), not this module's concern. */
	readonly args: readonly string[];
	readonly cwd: string;
	readonly env?: Record<string, string | undefined>;
}

const DEFAULT_READY_POLL_INTERVAL_MS = 100;

interface VehicleLoopbackClient {
	manifest(): Promise<VehicleManifest>;
	invoke(name: string, version: number, input: unknown, options?: VehicleInvocationOptions): Promise<unknown>;
	close(): Promise<void>;
}

export class VehicleLoopbackActivationError extends Error {
	constructor(vehicleName: string, message: string, options: { cause?: unknown } = {}) {
		super(`Vehicle loopback contribution "${vehicleName}": ${message}`, options);
		this.name = "VehicleLoopbackActivationError";
	}
}

interface VehicleLoopbackRegistration {
	readonly id: string;
}

interface VehicleLoopbackPointRegistry {
	register(kind: "vehicle-loopback", value: VehicleLoopbackRegistration, provenance: ContributionProvenance): () => void;
}

export interface VehicleLoopbackExecutionStrategyOptions {
	/** Defaults to resolveSharedVehicleTarget -- the same shared Vehicle Handle Directory credential lookup createSharedVehicleSurfaceGateway uses. Injectable for tests. */
	readonly resolveTarget?: (vehicleName: string, env?: Record<string, string | undefined>) => Promise<VehicleSurfaceTarget>;
	readonly createClient?: (target: VehicleSurfaceTarget) => VehicleLoopbackClient;
	/**
	 * Defaults to a real spawnManagedProcess plus a poll loop against
	 * isReadyForPid. Injectable for tests. Deliberately lower-level than
	 * pi-process-harness's own spawnCompanionDaemon: that helper's isReady
	 * callback has no way to see the spawned process's own pid until after
	 * it has already resolved ready, which is exactly the freshness check
	 * this strategy needs (never mistake a stale leftover handle from an
	 * unrelated prior run under the same vehicleName for this activation's
	 * own process).
	 */
	readonly spawn?: (spec: VehicleLoopbackSpawnSpec, isReadyForPid: (pid: number | undefined) => boolean | Promise<boolean>, readyTimeoutMs: number) => Promise<ManagedProcess>;
	readonly readyTimeoutMs?: number;
	/** Bounds every command's own client.invoke() call independently of whatever timeout the spawned process's own Vehicle operation declares -- the real containment for a genuinely unresponsive process, not just a slow one. */
	readonly invokeTimeoutMs?: number;
}

function isFreshHandle(handlePath: string, spawnedPid: number | undefined): boolean {
	if (spawnedPid === undefined) return false;
	const handle = readDaemonHandle(handlePath);
	return handle !== null && handle.host === LOOPBACK_HOST && handle.pid === spawnedPid;
}

async function pollUntilReady(isReady: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await isReady()) return;
		if (Date.now() >= deadline) throw new Error(`did not become ready within ${timeoutMs}ms`);
		await new Promise((resolve) => setTimeout(resolve, DEFAULT_READY_POLL_INTERVAL_MS));
	}
}

async function defaultSpawn(spec: VehicleLoopbackSpawnSpec, isReadyForPid: (pid: number | undefined) => boolean | Promise<boolean>, readyTimeoutMs: number): Promise<ManagedProcess> {
	const process_ = spawnManagedProcess({ command: spec.command, args: spec.args, cwd: spec.cwd, env: filterDefinedEnv(spec.env) });
	try {
		await pollUntilReady(() => isReadyForPid(process_.pid), readyTimeoutMs);
	} catch (error) {
		if (!process_.hasExited) await process_.dispose();
		throw error;
	}
	return process_;
}

function filterDefinedEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
	if (!env) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(env)) if (value !== undefined) result[key] = value;
	return result;
}

function outcomeFromError(vehicleName: string, operationName: string, error: unknown): ContributionOutcome<unknown> {
	if (isVehicleError(error)) return { ok: false, code: error.code, message: error.message };
	if (error instanceof Error && error.name === "TimeoutError") return { ok: false, code: "vehicle-loopback-timeout", message: `Vehicle "${vehicleName}" command "${operationName}" did not respond in time` };
	return { ok: false, code: "vehicle-loopback-error", message: error instanceof Error ? error.message : "Vehicle loopback command failed" };
}

/**
 * The strategy's own host registration ("vehicle-loopback" is capacity-checked here the same
 * way createInProcessExecutionStrategy checks the exactly-one "editor" point) plus command
 * projection. host is captured once at construction (matching createInProcessExecutionStrategy's
 * own shape) rather than passed per-activation, so every call site stays uniform regardless of
 * which strategy a given contribution kind resolves to.
 */
export function createVehicleLoopbackExecutionStrategy(
	registry: VehicleLoopbackPointRegistry,
	host: ContributionHost,
	options: VehicleLoopbackExecutionStrategyOptions = {},
) {
	const resolveTarget = options.resolveTarget ?? ((vehicleName: string, env?: Record<string, string | undefined>) => resolveSharedVehicleTarget(vehicleName, { env }));
	const createClient = options.createClient ?? ((target: VehicleSurfaceTarget) => new RemoteVehicleClient({ baseUrl: target.baseUrl, token: target.token }));
	const spawn = options.spawn ?? defaultSpawn;
	const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_VEHICLE_LOOPBACK_READY_TIMEOUT_MS;
	const invokeTimeoutMs = options.invokeTimeoutMs ?? DEFAULT_VEHICLE_LOOPBACK_INVOKE_TIMEOUT_MS;

	return {
		async activate(vehicleName: string, title: string, spec: VehicleLoopbackSpawnSpec, provenance: ContributionProvenance): Promise<ActiveContribution> {
			const unregisterPoint = registry.register("vehicle-loopback", { id: vehicleName }, provenance);
			let daemon: ManagedProcess | undefined;
			let client: VehicleLoopbackClient | undefined;
			const unregisterCommands: Array<() => void> = [];
			try {
				const handlePath = resolveSharedVehicleHandlePath(vehicleName, { env: spec.env });
				daemon = await spawn(spec, (pid) => isFreshHandle(handlePath, pid), readyTimeoutMs);
				const target = await resolveTarget(vehicleName, spec.env);
				client = createClient(target);
				const manifest = await client.manifest();
				const description: ContributionDescription = {
					id: vehicleName,
					title,
					commands: manifest.operations.filter((operation) => operation.available).map((operation) => ({ id: operation.name, title: operation.name })),
					resourceSchemes: [],
					version: manifest.version,
					// Every vehicle-loopback contribution is agent-invokable by construction --
					// this contribution kind exists specifically to carry out-of-process
					// commands the integration.invoke dispatch path can reach (Scope item 4),
					// unlike the declarative "vehicle-surface" kind (a separate, read-oriented
					// Integration story that stays excluded from agent invocation).
					capabilities: ["agent-invokable"],
					contributionPoints: ["vehicle-loopback"],
				};
				const activeClient = client;
				for (const operation of manifest.operations) {
					if (!operation.available) continue;
					// A wrapped Vehicle operation's own output shape is whatever that operation
					// declares, not necessarily a ContributionResourceReference -- the same
					// wire reality invokeContributionCommand already treats generically as
					// ContributionOutcome<unknown>. The declared ContributionCommand.execute
					// return type is specific to Lector Surface's own resource-reference
					// consumer (apps/web/src/lector-surface/client.ts), which this
					// contribution kind does not participate in; the cast below is scoped to
					// exactly this one assembly point.
					const execute = async (input: unknown): Promise<ContributionOutcome<unknown>> => {
						try {
							const value = await activeClient.invoke(operation.name, operation.version, input, {
								signal: AbortSignal.timeout(invokeTimeoutMs),
								permissions: operation.permissions,
								principal: { id: `zodiac-vehicle-loopback:${vehicleName}` },
							});
							return { ok: true, value };
						} catch (error) {
							return outcomeFromError(vehicleName, operation.name, error);
						}
					};
					const command = { id: operation.name, title: operation.name, execute } as unknown as ContributionCommand;
					unregisterCommands.push(host.registerCommand(command));
				}
				let active = true;
				return {
					id: vehicleName,
					description,
					provenance,
					async dispose() {
						if (!active) return;
						active = false;
						for (const unregister of unregisterCommands.splice(0).reverse()) unregister();
						await activeClient.close();
						await daemon?.dispose();
						unregisterPoint();
					},
				};
			} catch (error) {
				for (const unregister of unregisterCommands.splice(0).reverse()) unregister();
				await client?.close();
				await daemon?.dispose();
				unregisterPoint();
				if (error instanceof VehicleLoopbackActivationError) throw error;
				throw new VehicleLoopbackActivationError(vehicleName, "activation failed", { cause: error });
			}
		},
	};
}
