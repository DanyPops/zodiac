import type { AppletDefinition, ContributionProvenance } from "@zodiac/protocol";
import { APPLET_CONTRIBUTION_POINT, appletId } from "@zodiac/protocol";
import { createContributionPointRegistry, type RegisteredContribution } from "./point-registry.js";

const BUILTIN_PROVENANCE: ContributionProvenance = { packageId: "@zodiac/server", version: "0.0.1", source: "builtin:@zodiac/server" };

type AppletPoints = { applet: AppletDefinition };

/** Applets use the same named-point/cardinality/provenance registry as editor contributions loaded by an ExecutionStrategy. */
export interface AppletRegistry {
	registerApplet: (definition: AppletDefinition, provenance?: ContributionProvenance) => () => void;
	applets: () => readonly AppletDefinition[];
	registrations: () => readonly RegisteredContribution<AppletDefinition>[];
}

export function createAppletRegistry(): AppletRegistry {
	const registry = createContributionPointRegistry<AppletPoints>([APPLET_CONTRIBUTION_POINT]);
	return {
		registerApplet: (definition, provenance = BUILTIN_PROVENANCE) => registry.register("applet", definition, provenance),
		applets: () => registry.entries("applet").map((entry) => entry.value),
		registrations: () => registry.entries("applet"),
	};
}

const HORIZONTAL_AND_VERTICAL = new Set(["horizontal", "vertical"] as const);

/**
 * The built-in Applet roster: cap Applets (settings maps to today's real
 * `appearance.open`; profile/time-jobs/notifications/integrations are real
 * registrations ahead of their own features -- placeholder content, not a
 * placeholder registration) and body Applets (workspace-nav, window-carousel,
 * chat -- today's real left-pillar/header/footer content).
 */
export function seedBuiltinApplets(registry: AppletRegistry): void {
	const caps: readonly AppletDefinition[] = [
		{ id: appletId("settings"), title: "Settings", slot: "cap", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
		{ id: appletId("profile"), title: "Profile", slot: "cap", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
		{ id: appletId("time-jobs"), title: "Time", slot: "cap", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
		{ id: appletId("notifications"), title: "Notifications", slot: "cap", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
		{ id: appletId("integrations"), title: "Integrations", slot: "cap", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
	];
	const body: readonly AppletDefinition[] = [
		{ id: appletId("workspace-nav"), title: "Workspace navigation", slot: "body", supportedFormFactors: new Set(["vertical"]), maxInstances: 1 },
		{ id: appletId("window-carousel"), title: "Window carousel", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 },
		{ id: appletId("chat"), title: "Chat", slot: "body", supportedFormFactors: HORIZONTAL_AND_VERTICAL, maxInstances: 1 },
		{ id: appletId("surface-templates"), title: "Surface Templates", slot: "body", supportedFormFactors: new Set(["vertical"]), maxInstances: 1 },
	];
	for (const applet of [...caps, ...body]) registry.registerApplet(applet);
}
