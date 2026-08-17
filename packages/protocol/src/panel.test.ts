import { describe, expect, it } from "vitest";
import { appletId, panelId } from "./ids.js";
import type { AppletDefinition } from "./panel.js";
import { AppletDefinitionSchema, formFactorForLocation, LocationSchema, PanelSchema, validatePanelAppletAssignment } from "./panel.js";

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

	it("rejects a cap Applet with maxInstances above 1", () => {
		const parsed = AppletDefinitionSchema.safeParse(validApplet({ slot: "cap", maxInstances: 2 }));
		expect(parsed.success).toBe(false);
	});

	it("accepts a cap Applet with maxInstances exactly 1", () => {
		const parsed = AppletDefinitionSchema.safeParse(validApplet({ slot: "cap", maxInstances: 1 }));
		expect(parsed.success).toBe(true);
	});
});

function validPanel(overrides: Partial<Parameters<typeof PanelSchema.parse>[0]> = {}) {
	return {
		id: panelId("footer"),
		location: "bottom" as const,
		alignment: "start" as const,
		offset: 0,
		thickness: 3,
		thicknessUnit: "terminal-cells" as const,
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

	it("accepts both real thickness units, rejects an unknown one", () => {
		expect(PanelSchema.safeParse(validPanel({ thicknessUnit: "px" })).success).toBe(true);
		expect(PanelSchema.safeParse(validPanel({ thicknessUnit: "terminal-cells" })).success).toBe(true);
		expect(PanelSchema.safeParse(validPanel({ thicknessUnit: "rem" })).success).toBe(false);
	});
});

describe("validatePanelAppletAssignment", () => {
	const chat: AppletDefinition = { id: appletId("chat"), title: "Chat", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 4 };
	const settings: AppletDefinition = { id: appletId("settings"), title: "Settings", slot: "cap", supportedFormFactors: new Set(["horizontal", "vertical"]), maxInstances: 1 };
	const registry = new Map([
		[chat.id, chat],
		[settings.id, settings],
	]);
	const appletById = (id: ReturnType<typeof appletId>) => registry.get(id);

	it("accepts a body Applet in body and a cap Applet in a cap", () => {
		const panel = validPanel({ startCap: settings.id, body: [chat.id] });
		expect(validatePanelAppletAssignment(panel, appletById)).toEqual({ ok: true, value: true });
	});

	it("rejects a body Applet assigned to startCap", () => {
		const panel = validPanel({ startCap: chat.id, body: [] });
		const result = validatePanelAppletAssignment(panel, appletById);
		expect(result.ok).toBe(false);
	});

	it("rejects a cap Applet assigned to body", () => {
		const panel = validPanel({ body: [settings.id] });
		const result = validatePanelAppletAssignment(panel, appletById);
		expect(result.ok).toBe(false);
	});

	it("rejects an AppletId with no registered AppletDefinition", () => {
		const panel = validPanel({ body: [appletId("unregistered")] });
		const result = validatePanelAppletAssignment(panel, appletById);
		expect(result.ok).toBe(false);
	});
});
