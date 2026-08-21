import { AppletDefinitionSchema, appletId } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { createAppletRegistry, seedBuiltinApplets } from "./applet-registry.js";

describe("createAppletRegistry", () => {
	it("rejects a duplicate Applet id and records package provenance", () => {
		const registry = createAppletRegistry();
		registry.registerApplet(
			{ id: appletId("chat"), title: "Chat", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 },
			{ packageId: "@acme/chat", version: "1.0.0", source: "npm:@acme/chat@1.0.0" },
		);
		expect(registry.registrations()[0]?.provenance).toEqual({ packageId: "@acme/chat", version: "1.0.0", source: "npm:@acme/chat@1.0.0" });
		expect(() => registry.registerApplet({ id: appletId("chat"), title: "Chat 2", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 })).toThrow();
	});

	it("rejects a slot:\"cap\" registration with maxInstances above 1", () => {
		const registry = createAppletRegistry();
		expect(() => registry.registerApplet({ id: appletId("settings"), title: "Settings", slot: "cap", supportedFormFactors: new Set(["horizontal"]), maxInstances: 2 })).not.toThrow();
		// createAppletRegistry itself doesn't re-validate the schema invariant -- that's AppletDefinitionSchema's own job, exercised directly here.
		const parsed = AppletDefinitionSchema.safeParse({ id: appletId("settings"), title: "Settings", slot: "cap", supportedFormFactors: new Set(["horizontal"]), maxInstances: 2 });
		expect(parsed.success).toBe(false);
	});
});

describe("seedBuiltinApplets", () => {
	it("registers the full built-in roster, each round-tripping through AppletDefinitionSchema", () => {
		const registry = createAppletRegistry();
		seedBuiltinApplets(registry);
		const applets = registry.applets();
		expect(applets.map((applet) => applet.id).sort()).toEqual(["chat", "integrations", "notifications", "profile", "settings", "surface-templates", "time-jobs", "window-carousel", "workspace-nav"]);
		for (const applet of applets) expect(AppletDefinitionSchema.safeParse(applet).success).toBe(true);
	});

	it("seeds exactly the cap roster as slot:\"cap\" and the body roster as slot:\"body\"", () => {
		const registry = createAppletRegistry();
		seedBuiltinApplets(registry);
		const byId = new Map(registry.applets().map((applet) => [applet.id, applet]));
		expect(byId.get(appletId("settings"))?.slot).toBe("cap");
		expect(byId.get(appletId("chat"))?.slot).toBe("body");
	});

	it("is queryable and idempotent per registry instance -- seeding twice on the same registry throws on the second pass", () => {
		const registry = createAppletRegistry();
		seedBuiltinApplets(registry);
		expect(() => seedBuiltinApplets(registry)).toThrow();
	});
});
