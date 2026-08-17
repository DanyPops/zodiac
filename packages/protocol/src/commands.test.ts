import { describe, expect, it } from "vitest";
import { CommandIntentSchema } from "./commands.js";

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
});
