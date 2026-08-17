import { describe, expect, it } from "vitest";
import { appletId, panelId } from "./ids.js";
import { AppletDefinitionSchema, formFactorForLocation, LocationSchema, PanelSchema } from "./panel.js";

describe("LocationSchema", () => {
	it.each(["floating", "top", "bottom", "left", "right"])("accepts %s", (value) => {
		expect(LocationSchema.safeParse(value).success).toBe(true);
	});

	it("rejects an unknown location", () => {
		expect(LocationSchema.safeParse("center-screen").success).toBe(false);
	});
});

describe("formFactorForLocation", () => {
	it("is vertical for left and right", () => {
		expect(formFactorForLocation("left")).toBe("vertical");
		expect(formFactorForLocation("right")).toBe("vertical");
	});

	it("is horizontal for top, bottom, and floating", () => {
		expect(formFactorForLocation("top")).toBe("horizontal");
		expect(formFactorForLocation("bottom")).toBe("horizontal");
		expect(formFactorForLocation("floating")).toBe("horizontal");
	});
});

function validApplet(overrides: Partial<Parameters<typeof AppletDefinitionSchema.parse>[0]> = {}) {
	return { id: appletId("chat"), title: "Chat", slot: "body" as const, supportedFormFactors: new Set(["horizontal"] as const), maxInstances: 4, ...overrides };
}

describe("AppletDefinitionSchema", () => {
	it("round-trips a valid body Applet", () => {
		const parsed = AppletDefinitionSchema.safeParse(validApplet());
		expect(parsed.success).toBe(true);
	});

	it("rejects an empty supportedFormFactors set", () => {
		const parsed = AppletDefinitionSchema.safeParse(validApplet({ supportedFormFactors: new Set() }));
		expect(parsed.success).toBe(false);
	});

	it("rejects a non-positive maxInstances", () => {
		const parsed = AppletDefinitionSchema.safeParse(validApplet({ maxInstances: 0 }));
		expect(parsed.success).toBe(false);
	});
});

function validPanel(overrides: Partial<Parameters<typeof PanelSchema.parse>[0]> = {}) {
	return {
		id: panelId("footer"),
		location: "bottom" as const,
		alignment: "start" as const,
		offset: 0,
		thickness: 3,
		lengthMode: "fill" as const,
		visibilityMode: "normal" as const,
		startCap: null,
		endCap: null,
		body: [appletId("chat")],
		...overrides,
	};
}

describe("PanelSchema", () => {
	it("round-trips a valid Panel", () => {
		expect(PanelSchema.safeParse(validPanel()).success).toBe(true);
	});

	it("accepts a Panel with both Caps assigned", () => {
		const parsed = PanelSchema.safeParse(validPanel({ startCap: appletId("workspace-nav"), endCap: appletId("settings") }));
		expect(parsed.success).toBe(true);
	});

	it("rejects a non-positive thickness", () => {
		expect(PanelSchema.safeParse(validPanel({ thickness: 0 })).success).toBe(false);
	});

	it("rejects an unknown lengthMode", () => {
		expect(PanelSchema.safeParse(validPanel({ lengthMode: "auto" })).success).toBe(false);
	});
});
