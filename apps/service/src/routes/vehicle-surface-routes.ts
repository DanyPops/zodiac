import type { IncomingMessage, ServerResponse } from "node:http";
import { VehicleSurfaceInvokeRequestSchema, parseWithSchema } from "@zodiac/protocol";
import type { VehicleSurfaceGateway } from "@zodiac/server/vehicle";
import { writeSseFrame } from "./sse-writer.js";

const MAX_INVOKE_BODY_BYTES = 1_048_576;

function writeJson(res: ServerResponse, status: number, body: unknown): void {
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(JSON.stringify(body));
}

function isTrustedLocalOrigin(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		const url = new URL(origin);
		return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
	} catch {
		return false;
	}
}

function readBoundedJson(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		let exceeded = false;
		req.on("data", (chunk: Buffer) => {
			if (exceeded) return;
			bytes += chunk.byteLength;
			if (bytes > MAX_INVOKE_BODY_BYTES) {
				exceeded = true;
				reject(new Error("request-too-large"));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (exceeded) return;
			try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
			catch { reject(new Error("invalid-json")); }
		});
		req.on("error", reject);
	});
}

export function createVehicleSurfaceRoutes(gateway: VehicleSurfaceGateway) {
	return {
		list(req: IncomingMessage, res: ServerResponse): void {
			if (!isTrustedLocalOrigin(req)) { writeJson(res, 403, { code: "untrusted-origin", message: "Vehicle Surfaces are available only to local Zodiac clients." }); return; }
			writeJson(res, 200, { surfaces: gateway.list() });
		},
		async manifest(req: IncomingMessage, res: ServerResponse, surfaceId: string): Promise<void> {
			if (!isTrustedLocalOrigin(req)) { writeJson(res, 403, { code: "untrusted-origin", message: "Vehicle Surfaces are available only to local Zodiac clients." }); return; }
			try { writeJson(res, 200, await gateway.manifest(surfaceId)); }
			catch (error) { writeJson(res, 503, { code: "vehicle-surface-unavailable", message: error instanceof Error ? error.message : "Vehicle Surface unavailable" }); }
		},
		async invoke(req: IncomingMessage, res: ServerResponse, surfaceId: string): Promise<void> {
			if (!isTrustedLocalOrigin(req)) { writeJson(res, 403, { code: "untrusted-origin", message: "Vehicle Surfaces are available only to local Zodiac clients." }); return; }
			let input: unknown;
			try { input = await readBoundedJson(req); }
			catch (error) { writeJson(res, error instanceof Error && error.message === "request-too-large" ? 413 : 400, { code: error instanceof Error ? error.message : "invalid-json", message: "Invalid Vehicle Surface invocation body." }); return; }
			const parsed = parseWithSchema(VehicleSurfaceInvokeRequestSchema, input);
			if (!parsed.ok) { writeJson(res, 400, { code: "invalid-invocation", message: "Invalid Vehicle Surface invocation.", issues: parsed.issues }); return; }
			writeJson(res, 200, await gateway.invoke(surfaceId, parsed.value));
		},
		async events(req: IncomingMessage, res: ServerResponse, surfaceId: string): Promise<void> {
			if (!isTrustedLocalOrigin(req)) { writeJson(res, 403, { code: "untrusted-origin", message: "Vehicle Surfaces are available only to local Zodiac clients." }); return; }
			let closed = false;
			let subscription: { close(): void } | undefined;
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			res.flushHeaders();
			try {
				subscription = await gateway.subscribe(surfaceId, (event) => {
					if (!closed) writeSseFrame(res, { event: "vehicle-surface", data: event });
				});
			} catch (error) {
				writeSseFrame(res, { event: "vehicle-surface-error", data: { code: "vehicle-surface-unavailable", message: error instanceof Error ? error.message : "Vehicle Surface unavailable" } });
				res.end();
				return;
			}
			const close = (): void => { if (closed) return; closed = true; subscription?.close(); };
			req.on("close", close);
			res.on("close", close);
		},
	};
}
