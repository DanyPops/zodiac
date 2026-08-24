import { integrationId } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { AGENT_INVOKABLE_CAPABILITY, createContributionInvokeHandler, integrationDefinitionsFrom } from "./agent-invokable-integration.js";

describe("integrationDefinitionsFrom", () => {
	it("derives hasApi: true only for an editor/applet entry that declares the agent-invokable capability tag", () => {
		const definitions = integrationDefinitionsFrom([
			{ id: "lector", kind: "editor", description: { id: "lector", title: "Lector", commands: [{ id: "lector.file.save", title: "Save" }], resourceSchemes: [], capabilities: [AGENT_INVOKABLE_CAPABILITY] } },
			{ id: "readonly-viewer", kind: "editor", description: { id: "readonly-viewer", title: "Viewer", commands: [], resourceSchemes: [] } },
		]);

		expect(definitions).toEqual([
			{ id: integrationId("lector"), title: "Lector", capabilities: { renderable: true, hasApi: true } },
			{ id: integrationId("readonly-viewer"), title: "Viewer", capabilities: { renderable: true, hasApi: false } },
		]);
	});

	it("skips a vehicle-surface entry -- that kind is projected separately by vehicleSurfaceDefinitionsFrom, not through this Integration/hasApi path", () => {
		const definitions = integrationDefinitionsFrom([{ id: "papyrus", kind: "vehicle-surface", description: { id: "papyrus", title: "Papyrus", commands: [], resourceSchemes: [] } }]);
		expect(definitions).toEqual([]);
	});

	it("falls back to the entry's own id as title when no description is present", () => {
		const definitions = integrationDefinitionsFrom([{ id: "bare-applet", kind: "applet" }]);
		expect(definitions).toEqual([{ id: integrationId("bare-applet"), title: "bare-applet", capabilities: { renderable: true, hasApi: false } }]);
	});
});

describe("createContributionInvokeHandler", () => {
	it("forwards action/input to invokeContributionCommand against the given contributionId, using the caller-supplied registry", async () => {
		const command = { id: "lector.file.save", title: "Save", execute: async (input: unknown) => ({ ok: true as const, value: { uri: `file://${(input as { path: string }).path}`, kind: "file", title: "a.ts", readOnly: false } }) };
		const handler = createContributionInvokeHandler("lector", { descriptions: new Map([["lector", { id: "lector", title: "Lector", commands: [{ id: "lector.file.save", title: "Save" }], resourceSchemes: [] }]]), commands: new Map([["lector.file.save", command]]) });

		const result = await handler("lector.file.save", { path: "a.ts" });

		expect(result).toEqual({ ok: true, value: { uri: "file://a.ts", kind: "file", title: "a.ts", readOnly: false } });
	});
});
