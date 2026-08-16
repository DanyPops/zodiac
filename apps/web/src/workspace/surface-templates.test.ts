import { describe, expect, it } from "vitest";
import { IntegrationDefinitionSchema } from "@zodiac/protocol";
import { findSurfaceTemplate, SURFACE_TEMPLATE_REGISTRY } from "./surface-templates.js";

describe("surface templates registry", () => {
	it("declares at least one template with unique integration ids and dock command ids", () => {
		expect(SURFACE_TEMPLATE_REGISTRY.length).toBeGreaterThan(0);
		const ids = SURFACE_TEMPLATE_REGISTRY.map((template) => template.integrationId);
		const commandIds = SURFACE_TEMPLATE_REGISTRY.map((template) => template.dockCommandId);
		expect(new Set(ids).size).toBe(ids.length);
		expect(new Set(commandIds).size).toBe(commandIds.length);
	});

	it("every built-in template's integrationId is a real, valid @zodiac/protocol IntegrationId", () => {
		for (const template of SURFACE_TEMPLATE_REGISTRY) {
			expect(IntegrationDefinitionSchema.safeParse({ id: template.integrationId, title: template.title, capabilities: { renderable: true, hasApi: false } }).success).toBe(true);
		}
	});

	it("findSurfaceTemplate resolves a known id and returns undefined for an unknown one", () => {
		const [first] = SURFACE_TEMPLATE_REGISTRY;
		expect(findSurfaceTemplate(first!.integrationId)).toBe(first);
		expect(findSurfaceTemplate("does-not-exist")).toBeUndefined();
	});

	it("renders every template's docked content from the registry, not a caller-owned switch", () => {
		for (const template of SURFACE_TEMPLATE_REGISTRY) {
			expect(template.render()).toBeTruthy();
		}
	});
});
