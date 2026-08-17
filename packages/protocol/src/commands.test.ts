import { describe, expect, it } from "vitest";
import { COMMAND_INTENT_MIN_VERSION, COMMAND_INTENT_PROTOCOL_VERSION, CommandIntentSchema, isSupportedCommandIntent, type CommandIntent } from "./commands.js";

describe("CommandIntentSchema", () => {
	it("accepts a well-formed surface.dock intent", () => {
		const result = CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "bug-triage", integrationId: "activity", title: "Activity" });
		expect(result.success).toBe(true);
	});

	it("accepts surface.dock without the optional windowId", () => {
		expect(CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1", integrationId: "activity", title: "Activity" }).success).toBe(true);
	});

	it("rejects an unknown intent type", () => {
		expect(CommandIntentSchema.safeParse({ type: "surface.teleport", workspaceId: "w1" }).success).toBe(false);
	});

	it("rejects surface.dock missing a required field", () => {
		expect(CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1" }).success).toBe(false);
	});

	it("rejects a plain string or null instead of an intent object", () => {
		expect(CommandIntentSchema.safeParse("surface.dock").success).toBe(false);
		expect(CommandIntentSchema.safeParse(null).success).toBe(false);
	});

	it("accepts window.next/window.previous with just a workspaceId", () => {
		expect(CommandIntentSchema.safeParse({ type: "window.next", workspaceId: "w1" }).success).toBe(true);
		expect(CommandIntentSchema.safeParse({ type: "window.previous", workspaceId: "w1" }).success).toBe(true);
	});

	it("accepts an optional commandId on every variant, and round-trips it unchanged", () => {
		const withId = CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1", integrationId: "activity", title: "Activity", commandId: "cmd-1" });
		expect(withId.success).toBe(true);
		if (withId.success) expect(withId.data.commandId).toBe("cmd-1");

		expect(CommandIntentSchema.safeParse({ type: "window.next", workspaceId: "w1", commandId: "cmd-2" }).success).toBe(true);
	});

	it("still accepts every variant without a commandId (optional, not required)", () => {
		expect(CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1", integrationId: "activity", title: "Activity" }).success).toBe(true);
	});

	it("rejects a blank commandId, same rule as every other branded id", () => {
		expect(CommandIntentSchema.safeParse({ type: "window.next", workspaceId: "w1", commandId: "" }).success).toBe(false);
	});

	it("accepts an optional caller-supplied surfaceId on surface.dock, same shape workspace.create already has for workspaceId", () => {
		const result = CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1", integrationId: "activity", title: "Activity", surfaceId: "client-surface-1" });
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "surface.dock") expect(result.data.surfaceId).toBe("client-surface-1");
	});

	it("still accepts surface.dock without a surfaceId (optional, not required)", () => {
		expect(CommandIntentSchema.safeParse({ type: "surface.dock", workspaceId: "w1", integrationId: "activity", title: "Activity" }).success).toBe(true);
	});

	it("accepts a well-formed panel.move intent, with no workspaceId at all", () => {
		const result = CommandIntentSchema.safeParse({ type: "panel.move", panelId: "footer", placement: { location: "top", alignment: "center", offset: 2 } });
		expect(result.success).toBe(true);
	});

	it("rejects panel.move with an unknown Location or PanelAlignment", () => {
		expect(CommandIntentSchema.safeParse({ type: "panel.move", panelId: "footer", placement: { location: "diagonal", alignment: "center", offset: 0 } }).success).toBe(false);
		expect(CommandIntentSchema.safeParse({ type: "panel.move", panelId: "footer", placement: { location: "top", alignment: "justify", offset: 0 } }).success).toBe(false);
	});

	it("accepts a well-formed panel.resize intent", () => {
		expect(CommandIntentSchema.safeParse({ type: "panel.resize", panelId: "workspace-nav", thickness: 256 }).success).toBe(true);
	});

	it("rejects a non-positive panel.resize thickness", () => {
		expect(CommandIntentSchema.safeParse({ type: "panel.resize", panelId: "workspace-nav", thickness: 0 }).success).toBe(false);
	});

	it("accepts a well-formed integration.invoke intent, with an arbitrary action string and an opaque input payload this schema never inspects", () => {
		const result = CommandIntentSchema.safeParse({ type: "integration.invoke", workspaceId: "w1", integrationId: "lector", action: "symbol.search", input: { query: "createWorldStore", limit: 10 } });
		expect(result.success).toBe(true);
		if (result.success && result.data.type === "integration.invoke") expect(result.data.input).toEqual({ query: "createWorldStore", limit: 10 });
	});

	it("accepts integration.invoke with input omitted (unknown, not required to be an object)", () => {
		expect(CommandIntentSchema.safeParse({ type: "integration.invoke", workspaceId: "w1", integrationId: "lector", action: "symbol.search" }).success).toBe(true);
	});

	it("rejects integration.invoke missing a required field (workspaceId, integrationId, or action)", () => {
		expect(CommandIntentSchema.safeParse({ type: "integration.invoke", integrationId: "lector", action: "symbol.search" }).success).toBe(false);
		expect(CommandIntentSchema.safeParse({ type: "integration.invoke", workspaceId: "w1", action: "symbol.search" }).success).toBe(false);
		expect(CommandIntentSchema.safeParse({ type: "integration.invoke", workspaceId: "w1", integrationId: "lector" }).success).toBe(false);
	});

	it("rejects a blank action string, same rule as every other non-empty string field in this union", () => {
		expect(CommandIntentSchema.safeParse({ type: "integration.invoke", workspaceId: "w1", integrationId: "lector", action: "" }).success).toBe(false);
	});
});

describe("CommandIntentSchema version/capability negotiation", () => {
	it("every real variant records a minimum version at or below the protocol's current version", () => {
		for (const type of Object.keys(COMMAND_INTENT_MIN_VERSION) as (keyof typeof COMMAND_INTENT_MIN_VERSION)[]) {
			expect(COMMAND_INTENT_MIN_VERSION[type]).toBeLessThanOrEqual(COMMAND_INTENT_PROTOCOL_VERSION);
		}
	});

	it("isSupportedCommandIntent accepts a structurally valid intent when the caller declares support for its minimum version", () => {
		const intent = { type: "window.next", workspaceId: "w1" } as CommandIntent;
		expect(isSupportedCommandIntent(intent, COMMAND_INTENT_PROTOCOL_VERSION)).toBe(true);
	});

	it("isSupportedCommandIntent fails loud (returns false, doesn't throw or guess) for a structurally valid intent whose variant requires a newer protocol version than the caller declares", () => {
		const intent = { type: "window.next", workspaceId: "w1" } as CommandIntent;
		// A hypothetical dispatcher that only understands protocol version 0 --
		// older than every real variant's own recorded minimum -- must reject
		// this intent rather than dispatch it into undefined behavior.
		expect(isSupportedCommandIntent(intent, 0)).toBe(false);
	});

	it("a real, live version skew: a dispatcher that only understands protocol version 1 (before integration.invoke existed) rejects an integration.invoke intent, but still accepts every version-1 variant", () => {
		const invoke = { type: "integration.invoke", workspaceId: "w1", integrationId: "lector", action: "symbol.search", input: {} } as CommandIntent;
		const windowNext = { type: "window.next", workspaceId: "w1" } as CommandIntent;
		expect(isSupportedCommandIntent(invoke, 1)).toBe(false);
		expect(isSupportedCommandIntent(windowNext, 1)).toBe(true);
		expect(isSupportedCommandIntent(invoke, COMMAND_INTENT_PROTOCOL_VERSION)).toBe(true);
	});

	it("a dispatcher that only understands protocol version 2 (before panel.resize existed) rejects panel.resize, but still accepts integration.invoke", () => {
		const resize = { type: "panel.resize", panelId: "workspace-nav", thickness: 256 } as CommandIntent;
		const invoke = { type: "integration.invoke", workspaceId: "w1", integrationId: "lector", action: "symbol.search" } as CommandIntent;
		expect(isSupportedCommandIntent(resize, 2)).toBe(false);
		expect(isSupportedCommandIntent(invoke, 2)).toBe(true);
		expect(isSupportedCommandIntent(resize, COMMAND_INTENT_PROTOCOL_VERSION)).toBe(true);
	});
});
