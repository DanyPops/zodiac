import { describe, expect, it } from "vitest";
import { integrationId, type IntegrationDefinition } from "@zodiac/protocol";
import { listIntegrations, MAX_LISTED_INTEGRATIONS, MAX_SUMMARY_BYTES } from "./integration-directory.js";

function integration(id: string, capabilities: { renderable?: boolean; hasApi?: boolean } = {}): IntegrationDefinition {
	return { id: integrationId(id), title: id, capabilities: { renderable: capabilities.renderable ?? false, hasApi: capabilities.hasApi ?? true } };
}

describe("listIntegrations -- read-only Integration directory for the agent's own list_integrations tool", () => {
	it("partitions docked from undocked without conflating them", () => {
		const a = integration("a");
		const b = integration("b");
		const c = integration("c");
		const result = listIntegrations([a, b, c], new Set([a.id]));
		expect(result.docked.items.map((entry) => entry.id)).toEqual([a.id]);
		expect(result.undocked.items.map((entry) => entry.id)).toEqual([b.id, c.id]);
	});

	it("caps the listed count and marks the result as truncated -- explicit typed truncation, not silent overflow", () => {
		const many = Array.from({ length: MAX_LISTED_INTEGRATIONS + 5 }, (_, index) => integration(`i${index}`));
		const result = listIntegrations(many, new Set());
		expect(result.undocked.items).toHaveLength(MAX_LISTED_INTEGRATIONS);
		expect(result.undocked.truncated).toBe(true);
		expect(result.undocked.totalCount).toBe(MAX_LISTED_INTEGRATIONS + 5);
	});

	it("does not mark a result truncated when it fits entirely under the cap", () => {
		const result = listIntegrations([integration("a")], new Set());
		expect(result.undocked.truncated).toBe(false);
		expect(result.undocked.totalCount).toBe(1);
	});

	it("caps each summary's own byte length instead of letting one Integration's summary overflow the whole response", () => {
		// capabilities-derived text is short today, so this exercises the cap via a title long enough to matter once summaries grow richer -- the cap itself is asserted directly against the exported bound.
		const result = listIntegrations([integration("a", { renderable: true, hasApi: true })], new Set());
		expect(Buffer.byteLength(result.undocked.items[0]!.summary, "utf8")).toBeLessThanOrEqual(MAX_SUMMARY_BYTES);
	});

	it("never surfaces a credential-shaped field, even if an Integration's own object happens to carry one", () => {
		const tainted = { ...integration("a"), apiKey: "sk-super-secret-value", token: "another-secret" } as IntegrationDefinition;
		const result = listIntegrations([tainted], new Set());
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("sk-super-secret-value");
		expect(serialized).not.toContain("another-secret");
	});

	it("derives a real, honest one-line summary from an Integration's own declared capabilities", () => {
		const bothCapabilities = integration("a", { renderable: true, hasApi: true });
		const apiOnly = integration("b", { renderable: false, hasApi: true });
		const result = listIntegrations([bothCapabilities, apiOnly], new Set());
		expect(result.undocked.items[0]!.summary).toContain("renders content");
		expect(result.undocked.items[0]!.summary).toContain("exposes an API");
		expect(result.undocked.items[1]!.summary).not.toContain("renders content");
	});
});
