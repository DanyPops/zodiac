import type { IncomingMessage, ServerResponse } from "node:http";
import {
	ContributionInvokeRequestSchema,
	ContributionResourceReadRequestSchema,
	parseWithSchema,
	type ContributionCommand,
	type ContributionDescription,
	type ContributionResourceProvider,
} from "@zodiac/protocol";

const MAX_BODY_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface ContributionRouteRegistry {
	readonly descriptions: readonly ContributionDescription[];
	readonly commands: ReadonlyMap<string, ContributionCommand>;
	readonly providers: ReadonlyMap<string, ContributionResourceProvider>;
}

function trusted(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	try {
		const url = new URL(origin);
		return (url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
	} catch { return false; }
}

function json(res: ServerResponse, status: number, body: unknown): void {
	let encoded: string;
	try { encoded = JSON.stringify(body); }
	catch { encoded = JSON.stringify({ ok: false, code: "non-serializable-response", message: "Contribution returned a non-serializable response." }); status = 502; }
	if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
		status = 502;
		encoded = JSON.stringify({ ok: false, code: "response-bound-exceeded", message: `Contribution response exceeds ${MAX_RESPONSE_BYTES} bytes.` });
	}
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json");
	res.setHeader("Cache-Control", "no-store");
	res.end(encoded);
}

function body(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let bytes = 0;
		let exceeded = false;
		req.on("data", (chunk: Buffer) => {
			if (exceeded) return;
			bytes += chunk.byteLength;
			if (bytes > MAX_BODY_BYTES) { exceeded = true; reject(new Error("request-too-large")); return; }
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

export function createContributionRoutes(registry: ContributionRouteRegistry) {
	const descriptions = new Map(registry.descriptions.map((description) => [description.id, description]));
	return {
		list(req: IncomingMessage, res: ServerResponse): void {
			if (!trusted(req)) { json(res, 403, { code: "untrusted-origin", message: "Contributions are available only to local Zodiac clients." }); return; }
			json(res, 200, { contributions: registry.descriptions });
		},
		async invoke(req: IncomingMessage, res: ServerResponse, contributionId: string): Promise<void> {
			if (!trusted(req)) { json(res, 403, { code: "untrusted-origin", message: "Contributions are available only to local Zodiac clients." }); return; }
			let raw: unknown;
			try { raw = await body(req); } catch (error) { json(res, error instanceof Error && error.message === "request-too-large" ? 413 : 400, { code: error instanceof Error ? error.message : "invalid-json" }); return; }
			const parsed = parseWithSchema(ContributionInvokeRequestSchema, raw);
			if (!parsed.ok) { json(res, 400, { code: "invalid-invocation", issues: parsed.issues }); return; }
			const description = descriptions.get(contributionId);
			if (!description) { json(res, 404, { code: "contribution-not-found" }); return; }
			if (!description.commands.some((command) => command.id === parsed.value.commandId)) { json(res, 404, { code: "command-not-found" }); return; }
			const command = registry.commands.get(parsed.value.commandId);
			if (!command) { json(res, 503, { code: "command-unavailable" }); return; }
			try { json(res, 200, await command.execute(parsed.value.input)); }
			catch (error) { json(res, 502, { ok: false, code: "contribution-error", message: error instanceof Error ? error.message : "Contribution command failed" }); }
		},
		async read(req: IncomingMessage, res: ServerResponse, contributionId: string): Promise<void> {
			if (!trusted(req)) { json(res, 403, { code: "untrusted-origin", message: "Contributions are available only to local Zodiac clients." }); return; }
			let raw: unknown;
			try { raw = await body(req); } catch (error) { json(res, error instanceof Error && error.message === "request-too-large" ? 413 : 400, { code: error instanceof Error ? error.message : "invalid-json" }); return; }
			const parsed = parseWithSchema(ContributionResourceReadRequestSchema, raw);
			if (!parsed.ok) { json(res, 400, { code: "invalid-resource-read", issues: parsed.issues }); return; }
			const description = descriptions.get(contributionId);
			if (!description) { json(res, 404, { code: "contribution-not-found" }); return; }
			let scheme: string;
			try { scheme = new URL(parsed.value.resource.uri).protocol.slice(0, -1); } catch { json(res, 400, { code: "invalid-resource-uri" }); return; }
			if (!description.resourceSchemes.includes(scheme)) { json(res, 404, { code: "provider-not-found" }); return; }
			const provider = registry.providers.get(scheme);
			if (!provider) { json(res, 503, { code: "provider-unavailable" }); return; }
			try { json(res, 200, await provider.read(parsed.value.resource, parsed.value.bounds)); }
			catch (error) { json(res, 502, { ok: false, code: "contribution-error", message: error instanceof Error ? error.message : "Contribution read failed" }); }
		},
	};
}
