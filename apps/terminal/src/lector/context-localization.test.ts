import { describe, expect, it } from "vitest";
import { createLectorHost } from "./lector-host.js";

const bounds = { maxSymbols: 5, maxBytes: 20_000, maxDepth: 2, deadlineMs: 1_000, cacheBounds: { maxFiles: 100, maxSymbolsPerFile: 50 } };

async function localized(cacheStatus: "cached" | "caching" | "not-cached", completeness = { lexical: "complete", graph: "complete", deadlineReached: false, candidateLimitReached: false }, truncated = false) {
	const host = createLectorHost({
		operations: {
			async call(operation) {
				if (operation === "workspace.registerPath") return { workspaceId: "ws-1", path: "/workspace" };
				if (operation === "workspace.cacheStatus") return { status: cacheStatus, ...(cacheStatus === "not-cached" ? { reason: "no-completed-generation" } : {}) };
				if (operation === "workspace.localizeContext") {
					return {
						queryTerms: ["cache"],
						candidates: [{ name: "refreshCache", kind: "function", role: "production", path: "/workspace/src/cache.ts", line: 7, character: 3, signature: "export function refreshCache()", score: 25, reasons: [{ kind: "symbol-name", detail: "symbol name contains: cache", score: 14 }] }],
						totalCandidates: 2,
						truncated,
						completeness,
					};
				}
				throw new Error(`unexpected operation: ${operation}`);
			},
		},
	});
	await host.activate();
	const workspace = await host.execute("lector.workspace.open", { path: "/workspace" });
	if (!workspace.ok) throw new Error(workspace.message);
	const result = await host.execute("lector.context.localize", { workspaceId: "ws-1", query: "where cache refreshes", ...bounds });
	if (!result.ok) return { host, result };
	const read = await host.read(result.value, { maxBytes: 20_000, maxEntries: 5 });
	return { host, result, read };
}

describe("bounded Lector context localization", () => {
	it("projects scored reasons, provenance, bounds, and Workspace-relative open targets", async () => {
		const fixture = await localized("cached");
		try {
			expect(fixture.result).toMatchObject({ ok: true });
			expect(fixture.read).toMatchObject({
				ok: true,
				value: {
					kind: "context-candidates",
					status: "ready",
					provenance: { source: "lector-localize-context", cacheStatus: "cached" },
					bounds,
					items: [{ score: 25, reasons: [{ kind: "symbol-name", score: 14 }], target: { path: "src/cache.ts", line: 7, character: 3, positionEncoding: "one-based-code-unit" } }],
				},
			});
		} finally {
			await fixture.host.dispose();
		}
	});

	it.each([
		["not-cached", { lexical: "complete", graph: "unavailable", deadlineReached: false, candidateLimitReached: false }, false, "partial"],
		["caching", { lexical: "truncated", graph: "bounded", deadlineReached: false, candidateLimitReached: true }, true, "partial"],
		["cached", { lexical: "complete", graph: "bounded", deadlineReached: true, candidateLimitReached: false }, true, "stale"],
	] as const)("keeps lexical candidates while reporting %s graph state", async (cacheStatus, completeness, truncated, status) => {
		const fixture = await localized(cacheStatus, completeness, truncated);
		try {
			expect(fixture.read).toMatchObject({ ok: true, value: { status, truncated, completeness, provenance: { cacheStatus } } });
		} finally {
			await fixture.host.dispose();
		}
	});

	it("exposes bounded workspace symbol search with typed targets", async () => {
		const host = createLectorHost({ operations: { call: async (operation) => operation === "workspace.registerPath" ? { workspaceId: "ws-1", path: "/workspace" } : operation === "workspace.findSymbols" ? { symbols: [{ name: "refreshCache", kind: "function", location: { path: "/workspace/src/cache.ts", line: 7, character: 3 } }], truncated: false, completeness: "partial", provenance: { authority: "parser", backend: "tree-sitter", languageId: "typescript", fidelity: "structural", freshness: "filesystem-snapshot", limitations: [] } } : {} } });
		await host.activate();
		try {
			await host.execute("lector.workspace.open", { path: "/workspace" });
			const result = await host.execute("lector.symbol.find", { workspaceId: "ws-1", query: "refresh", maxResults: 5, maxBytes: 20_000 });
			if (!result.ok) throw new Error(result.message);
			expect(await host.read(result.value, { maxBytes: 20_000, maxEntries: 5 })).toMatchObject({ ok: true, value: { kind: "symbol-results", status: "partial", truncated: false, items: [{ target: { path: "src/cache.ts", line: 7, character: 3 } }] } });
		} finally {
			await host.dispose();
		}
	});
});
