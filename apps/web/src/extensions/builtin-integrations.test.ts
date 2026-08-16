import { describe, expect, it } from "vitest";
import { IntegrationDefinitionSchema } from "@zodiac/protocol";
import { SURFACE_TEMPLATE_REGISTRY } from "../workspace/surface-templates.js";
import { BUILTIN_INTEGRATION_DEFINITIONS, findBuiltinIntegrationDefinition } from "./builtin-integrations.js";

describe("builtin Integration definitions", () => {
	it("registers exactly one real IntegrationDefinition per built-in Surface Template", () => {
		expect(BUILTIN_INTEGRATION_DEFINITIONS).toHaveLength(SURFACE_TEMPLATE_REGISTRY.length);
		for (const template of SURFACE_TEMPLATE_REGISTRY) {
			const definition = findBuiltinIntegrationDefinition(template.integrationId);
			expect(definition).toBeDefined();
			expect(definition?.title).toBe(template.title);
		}
	});

	it("every registered definition is a real, schema-valid IntegrationDefinition, renderable and without an API", () => {
		for (const definition of BUILTIN_INTEGRATION_DEFINITIONS) {
			expect(IntegrationDefinitionSchema.safeParse(definition).success).toBe(true);
			expect(definition.capabilities).toEqual({ renderable: true, hasApi: false });
		}
	});

	it("findBuiltinIntegrationDefinition returns undefined for an unknown id", () => {
		expect(findBuiltinIntegrationDefinition("does-not-exist")).toBeUndefined();
	});
});
