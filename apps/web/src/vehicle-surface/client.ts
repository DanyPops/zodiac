import {
	VehicleSurfaceEventSchema,
	VehicleSurfaceInvokeResultSchema,
	VehicleSurfaceManifestSchema,
	type VehicleSurfaceEvent,
	type VehicleSurfaceInvokeRequest,
	type VehicleSurfaceInvokeResult,
	type VehicleSurfaceManifest,
} from "@zodiac/protocol";

export interface VehicleSurfaceClient {
	manifest: (surfaceId: string) => Promise<VehicleSurfaceManifest>;
	invoke: (surfaceId: string, request: VehicleSurfaceInvokeRequest) => Promise<VehicleSurfaceInvokeResult>;
	subscribe: (surfaceId: string, listener: (event: VehicleSurfaceEvent) => void) => { close: () => void };
}

export interface HttpVehicleSurfaceClientOptions {
	readonly baseUrl: string;
	readonly fetcher?: typeof fetch;
	readonly EventSourceCtor?: typeof EventSource;
}

function route(baseUrl: string, surfaceId: string, action: string): string {
	return `${baseUrl}/api/vehicle-surfaces/${encodeURIComponent(surfaceId)}/${action}`;
}

export function createHttpVehicleSurfaceClient(options: HttpVehicleSurfaceClientOptions): VehicleSurfaceClient {
	const fetcher = options.fetcher ?? globalThis.fetch;
	const EventSourceCtor = options.EventSourceCtor ?? EventSource;
	return {
		async manifest(surfaceId) {
			const response = await fetcher(route(options.baseUrl, surfaceId, "manifest"));
			if (!response.ok) throw new Error(`Vehicle Surface manifest request failed (${response.status})`);
			const parsed = VehicleSurfaceManifestSchema.safeParse(await response.json());
			if (!parsed.success) throw new Error("Invalid Vehicle Surface manifest from zodiacd");
			return parsed.data;
		},
		async invoke(surfaceId, request) {
			const response = await fetcher(route(options.baseUrl, surfaceId, "invoke"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(request),
			});
			if (!response.ok) throw new Error(`Vehicle Surface invocation request failed (${response.status})`);
			const parsed = VehicleSurfaceInvokeResultSchema.safeParse(await response.json());
			if (!parsed.success) throw new Error("Invalid Vehicle Surface invocation result from zodiacd");
			return parsed.data;
		},
		subscribe(surfaceId, listener) {
			const source = new EventSourceCtor(route(options.baseUrl, surfaceId, "events"));
			source.addEventListener("vehicle-surface", (raw) => {
				if (!("data" in raw) || typeof raw.data !== "string") return;
				try {
					const parsed = VehicleSurfaceEventSchema.safeParse(JSON.parse(raw.data));
					if (parsed.success) listener(parsed.data);
				} catch {
					// Ignore one malformed frame; EventSource remains usable for later valid invalidations.
				}
			});
			return { close: () => source.close() };
		},
	};
}
