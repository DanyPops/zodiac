import type { AppletDefinition } from "@zodiac/protocol";
import { appletId } from "@zodiac/protocol";
import { createContributionRegistry } from "./registry.js";

/** An Applet registry, reusing createContributionRegistry's own generic machinery -- an Applet's `id` slots into the registry's TIntegration type parameter exactly as apps/web/src/extensions/builtin-integrations.ts already does for IntegrationDefinition; TCommand/TEvent go unused. */
export interface AppletRegistry {
	registerApplet: (definition: AppletDefinition) => void;
	applets: () => readonly AppletDefinition[];
}

export function createAppletRegistry(): AppletRegistry {
	const registry = createContributionRegistry<AppletDefinition, { id: string }, { type: string }>();
	return {
		registerApplet: (definition) => registry.register({ id: `applet:${definition.id}`, activate: (api) => api.registerIntegration(definition) }),
		applets: registry.integrations,
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
	];
	for (const applet of [...caps, ...body]) registry.registerApplet(applet);
}
