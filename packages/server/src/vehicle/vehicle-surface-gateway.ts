import { readFileSync, statSync } from "node:fs";
import type { VehicleInvocationOptions, VehicleManifest } from "@danypops/vehicle-core";
import { isVehicleError, vehicleEventTopic } from "@danypops/vehicle-core";
import { RemoteVehicleClient } from "@danypops/vehicle-client/http";
import { connectPushChannel, type PushChannelClient, type PushChannelState } from "@danypops/vehicle-client/daemon-client";
import { LOOPBACK_HOST, readDaemonHandle, resolveSharedVehicleHandlePath } from "@danypops/vehicle-server/paths";
import {
	VehicleSurfaceManifestSchema,
	type VehicleSurfaceEvent,
	type VehicleSurfaceFailure,
	type VehicleSurfaceInvokeRequest,
	type VehicleSurfaceInvokeResult,
	type VehicleSurfaceManifest,
} from "@zodiac/protocol";

const MAX_SURFACES = 32;
const MAX_TOKEN_BYTES = 4_096;

export interface VehicleSurfaceDefinition {
	readonly id: string;
	readonly title: string;
	readonly vehicleName: string;
	/** Compatibility invalidation topics for Vehicles that predate manifest-declared events. */
	readonly invalidationTopics?: readonly string[];
}

export interface VehicleSurfaceTarget {
	readonly baseUrl: string;
	readonly pushUrl: string;
	readonly token: string;
}

interface SurfaceVehicleClient {
	manifest(): Promise<VehicleManifest>;
	invoke(name: string, version: number, input: unknown, options?: VehicleInvocationOptions): Promise<unknown>;
	close(): Promise<void>;
}

interface PushOptions {
	readonly url: string | (() => string | Promise<string>);
	readonly token: string;
	readonly topics: readonly string[];
	readonly onMessage: (topic: string, payload: unknown) => void;
	readonly onStateChange?: (state: PushChannelState) => void;
}

export interface VehicleSurfaceGatewayOptions {
	readonly definitions: readonly VehicleSurfaceDefinition[];
	readonly resolveTarget: (vehicleName: string) => Promise<VehicleSurfaceTarget>;
	readonly createClient?: (target: VehicleSurfaceTarget) => SurfaceVehicleClient;
	readonly connectPush?: (options: PushOptions) => Pick<PushChannelClient, "close">;
}

export interface VehicleSurfaceGateway {
	list(): readonly { id: string; title: string }[];
	manifest(surfaceId: string): Promise<VehicleSurfaceManifest>;
	invoke(surfaceId: string, request: VehicleSurfaceInvokeRequest): Promise<VehicleSurfaceInvokeResult>;
	subscribe(surfaceId: string, emit: (event: VehicleSurfaceEvent) => void): Promise<{ close(): void }>;
}

export class VehicleSurfaceUnavailableError extends Error {
	readonly code = "vehicle-surface-unavailable";
	constructor(readonly surfaceId: string, message: string, options: { cause?: unknown } = {}) {
		super(message, options);
		this.name = "VehicleSurfaceUnavailableError";
	}
}

function definitionMap(definitions: readonly VehicleSurfaceDefinition[]): Map<string, VehicleSurfaceDefinition> {
	if (definitions.length > MAX_SURFACES) throw new Error(`Configured ${definitions.length} Vehicle Surfaces; cap is ${MAX_SURFACES}`);
	const byId = new Map<string, VehicleSurfaceDefinition>();
	for (const definition of definitions) {
		if (!definition.id.trim() || !definition.title.trim() || !definition.vehicleName.trim()) throw new Error("Vehicle Surface definitions require id, title, and vehicleName");
		if ((definition.invalidationTopics?.length ?? 0) > 64 || definition.invalidationTopics?.some((topic) => topic.length < 1 || topic.length > 200)) throw new Error(`Vehicle Surface ${definition.id} has invalid invalidation topics`);
		if (byId.has(definition.id)) throw new Error(`Duplicate Vehicle Surface id: ${definition.id}`);
		byId.set(definition.id, { ...definition });
	}
	return byId;
}

function projectManifest(definition: VehicleSurfaceDefinition, manifest: VehicleManifest): VehicleSurfaceManifest {
	return VehicleSurfaceManifestSchema.parse({
		id: definition.id,
		title: definition.title,
		vehicle: { name: manifest.name, version: manifest.version, description: manifest.description },
		operations: manifest.operations.map((operation) => ({
			name: operation.name,
			version: operation.version,
			description: operation.description,
			effect: operation.effect,
			available: operation.available,
			unavailableReason: operation.unavailableReason,
			approvalRequired: operation.approvalRequired ?? operation.effect !== "read",
			permissions: operation.permissions,
			limits: operation.limits,
		})),
		events: (manifest.events ?? []).map((event) => ({ name: event.name, version: event.version, description: event.description, maxPayloadBytes: event.maxPayloadBytes })),
	});
}

function failureOf(error: unknown): VehicleSurfaceFailure {
	if (isVehicleError(error)) {
		const failure = error.toFailure();
		return {
			code: failure.code,
			category: failure.category,
			message: failure.message,
			retryable: failure.retryable,
			...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
			...(failure.operationId === undefined ? {} : { operationId: failure.operationId }),
		};
	}
	if (error instanceof VehicleSurfaceUnavailableError) return { code: error.code, category: "unavailable", message: error.message, retryable: true };
	return { code: "vehicle-surface-internal", category: "internal", message: "Vehicle Surface operation failed", retryable: false };
}

function stateForPush(state: PushChannelState): "connecting" | "live" | "degraded" | "closed" {
	return state === "open" ? "live" : state;
}

export function createVehicleSurfaceGateway(options: VehicleSurfaceGatewayOptions): VehicleSurfaceGateway {
	const definitions = definitionMap(options.definitions);
	const createClient = options.createClient ?? ((target) => new RemoteVehicleClient({ baseUrl: target.baseUrl, token: target.token }));
	const connectPush = options.connectPush ?? connectPushChannel;

	function requireDefinition(surfaceId: string): VehicleSurfaceDefinition {
		const definition = definitions.get(surfaceId);
		if (!definition) throw new VehicleSurfaceUnavailableError(surfaceId, `Unknown Vehicle Surface: ${surfaceId}`);
		return definition;
	}

	async function liveManifest(definition: VehicleSurfaceDefinition): Promise<{ manifest: VehicleManifest; projected: VehicleSurfaceManifest }> {
		let client: SurfaceVehicleClient | undefined;
		try {
			const target = await options.resolveTarget(definition.vehicleName);
			client = createClient(target);
			const manifest = await client.manifest();
			return { manifest, projected: projectManifest(definition, manifest) };
		} catch (error) {
			if (error instanceof VehicleSurfaceUnavailableError) throw error;
			throw new VehicleSurfaceUnavailableError(definition.id, `Vehicle "${definition.vehicleName}" is unavailable`, { cause: error });
		} finally {
			await client?.close();
		}
	}

	return {
		list: () => [...definitions.values()].map(({ id, title }) => ({ id, title })),
		async manifest(surfaceId) {
			return (await liveManifest(requireDefinition(surfaceId))).projected;
		},
		async invoke(surfaceId, request) {
			const definition = requireDefinition(surfaceId);
			let client: SurfaceVehicleClient | undefined;
			try {
				const { manifest } = await liveManifest(definition);
				const operation = manifest.operations.find((candidate) => candidate.name === request.name && candidate.version === request.version);
				if (!operation) return { ok: false, error: { code: "operation-not-found", category: "not_found", message: `Vehicle operation ${request.name}@${request.version} is not declared`, retryable: false } };
				if (!operation.available) return { ok: false, error: { code: "operation-unavailable", category: "unavailable", message: operation.unavailableReason ?? `Vehicle operation ${request.name}@${request.version} is unavailable`, retryable: true } };
				const target = await options.resolveTarget(definition.vehicleName);
				client = createClient(target);
				const output = await client.invoke(request.name, request.version, request.input, {
					permissions: operation.permissions,
					principal: { id: `zodiac-vehicle-surface:${definition.id}` },
					idempotencyKey: request.idempotencyKey,
					expectedRevision: request.expectedRevision,
				});
				return { ok: true, output };
			} catch (error) {
				return { ok: false, error: failureOf(error) };
			} finally {
				await client?.close();
			}
		},
		async subscribe(surfaceId, emit) {
			const definition = requireDefinition(surfaceId);
			const { manifest } = await liveManifest(definition);
			const target = await options.resolveTarget(definition.vehicleName);
			emit({ type: "state", surfaceId, state: "connecting" });
			return connectPush({
				url: async () => (await options.resolveTarget(definition.vehicleName)).pushUrl,
				token: target.token,
				topics: [...new Set([...(definition.invalidationTopics ?? []), ...(manifest.events ?? []).map((event) => vehicleEventTopic(event.name, event.version))])],
				onMessage: (topic, payload) => emit({ type: "event", surfaceId, topic, payload }),
				onStateChange: (state) => emit({ type: "state", surfaceId, state: stateForPush(state) }),
			});
		},
	};
}

export interface SharedVehicleSurfaceGatewayOptions {
	readonly definitions: readonly VehicleSurfaceDefinition[];
	readonly env?: Record<string, string | undefined>;
	readonly home?: string;
}

export function createSharedVehicleSurfaceGateway(options: SharedVehicleSurfaceGatewayOptions): VehicleSurfaceGateway {
	return createVehicleSurfaceGateway({
		definitions: options.definitions,
		async resolveTarget(vehicleName) {
			const handlePath = resolveSharedVehicleHandlePath(vehicleName, { env: options.env, home: options.home });
			const handle = readDaemonHandle(handlePath);
			if (!handle || handle.host !== LOOPBACK_HOST || !handle.tokenPath) throw new VehicleSurfaceUnavailableError(vehicleName, `Vehicle "${vehicleName}" has no authenticated loopback handle`);
			const tokenSize = statSync(handle.tokenPath).size;
			if (tokenSize < 1 || tokenSize > MAX_TOKEN_BYTES) throw new VehicleSurfaceUnavailableError(vehicleName, `Vehicle "${vehicleName}" token file is invalid`);
			const token = readFileSync(handle.tokenPath, "utf8").trim();
			if (!token) throw new VehicleSurfaceUnavailableError(vehicleName, `Vehicle "${vehicleName}" token is empty`);
			const baseUrl = `http://${LOOPBACK_HOST}:${handle.port}`;
			return { baseUrl, pushUrl: `ws://${LOOPBACK_HOST}:${handle.port}/push`, token };
		},
	});
}
