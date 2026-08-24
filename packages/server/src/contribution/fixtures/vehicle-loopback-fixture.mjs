#!/usr/bin/env node
// A real, standalone Vehicle daemon fixture spawned as a genuine separate
// OS process by vehicle-loopback-execution-strategy.test.ts -- proving the
// strategy's own spawn/connect/dispose lifecycle against a real subprocess,
// not an in-process stand-in. Controlled entirely by environment variables
// so the same file covers the happy path and both required failure modes
// (a crash after activation, and a hang that never responds) without
// needing three near-duplicate fixture files.
//
// VEHICLE_LOOPBACK_FIXTURE_NAME   required -- this Vehicle's own name.
// VEHICLE_LOOPBACK_FIXTURE_MODE   "normal" (default) | "hang" | "crash-after-ready".
import { bindVehicleOperation, defineVehicleOperation, passthroughVehicleSchema } from "@danypops/vehicle-core";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { startDaemon } from "@danypops/vehicle-server/daemon";
import { createVehicleHttpApp } from "@danypops/vehicle-server/http";
import { ensureAuthToken, resolveDaemonPaths } from "@danypops/vehicle-server/paths";

const vehicleName = process.env.VEHICLE_LOOPBACK_FIXTURE_NAME;
if (!vehicleName) throw new Error("VEHICLE_LOOPBACK_FIXTURE_NAME is required");
const mode = process.env.VEHICLE_LOOPBACK_FIXTURE_MODE ?? "normal";

const echoOperation = defineVehicleOperation({
	name: "fixture.echo",
	version: 1,
	description: "Echoes its own input back, or hangs/crashes per VEHICLE_LOOPBACK_FIXTURE_MODE.",
	input: passthroughVehicleSchema,
	output: passthroughVehicleSchema,
	permissions: ["fixture:invoke"],
	effect: "read",
	idempotency: { mode: "safe" },
	limits: { defaultTimeoutMs: 5_000, maxTimeoutMs: 10_000, maxRequestBytes: 4_096, maxResponseBytes: 4_096 },
});

const registry = new VehicleRegistry({ name: vehicleName, version: "1.0.0", description: "vehicle-loopback execution strategy test fixture." });
registry.register("fixture", bindVehicleOperation(echoOperation, () => async (context) => {
	if (mode === "hang") return new Promise(() => {}); // Never resolves -- a genuine unresponsive operation, not a slow one.
	return context.input;
}));

const paths = resolveDaemonPaths({
	stateDirectoryName: vehicleName,
	databaseFilename: "fixture.sqlite",
	tokenFilename: "fixture.token",
	handleFilename: "daemon.json",
	systemdUnitName: "fixture.service",
});

const token = ensureAuthToken(paths.token, "Vehicle Loopback Fixture");

await startDaemon({
	daemonLabel: "Vehicle Loopback Fixture",
	handlePath: paths.handle,
	buildApp: () => createVehicleHttpApp({ registry, token }),
	vehicleName,
	tokenPath: paths.token,
});

if (mode === "crash-after-ready") {
	// A real, uncontrolled process death well after the handle is published
	// and this daemon is genuinely answering requests -- not a rejected
	// promise the strategy could catch synchronously during activation.
	setTimeout(() => process.exit(1), 250);
}
