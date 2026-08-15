import { Activity, SquareTerminal } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { ActivitySurfaceContent } from "./ActivitySurface.js";
import { TerminalSurfaceLazy } from "./TerminalSurfaceLazy.js";

export interface SurfaceTemplateIconProps {
	"aria-hidden"?: boolean | "true" | "false";
	size?: number;
	className?: string;
}

/**
 * One built-in Surface Template. Everything a consumer needs to render its
 * Surface Templates pillar glyph, its dock command, and its docked content
 * lives on this definition -- adding a template means adding an entry here,
 * not editing the pillar, the docking host, or commands/defaults.ts.
 */
export interface SurfaceTemplateDefinition {
	id: string;
	title: string;
	icon: ComponentType<SurfaceTemplateIconProps>;
	dockCommandId: string;
	dockCommandTitle: string;
	dockCommandDescription: string;
	render: () => ReactNode;
}

export const ACTIVITY_TEMPLATE_ID = "activity";
export const TERMINAL_TEMPLATE_ID = "terminal";

export const SURFACE_TEMPLATE_REGISTRY: readonly SurfaceTemplateDefinition[] = [
	{
		id: ACTIVITY_TEMPLATE_ID,
		title: "Activity",
		icon: Activity,
		dockCommandId: "template.dockActivity",
		dockCommandTitle: "Dock Activity",
		dockCommandDescription: "Dock a new Activity Surface into the active Window.",
		render: () => <ActivitySurfaceContent />,
	},
	{
		id: TERMINAL_TEMPLATE_ID,
		title: "Terminal",
		icon: SquareTerminal,
		dockCommandId: "template.dockTerminal",
		dockCommandTitle: "Dock Terminal",
		dockCommandDescription: "Dock a new real, interactive shell (zodiacd --enable-terminal) into the active Window.",
		render: () => <TerminalSurfaceLazy />,
	},
];

/** `extra` -- e.g. an ExtensionHost's registered templates -- is searched after the built-in registry, so a built-in id always wins a collision. */
export function findSurfaceTemplate(templateId: string, extra: readonly SurfaceTemplateDefinition[] = []): SurfaceTemplateDefinition | undefined {
	return SURFACE_TEMPLATE_REGISTRY.find((template) => template.id === templateId) ?? extra.find((template) => template.id === templateId);
}
