import { useState } from "react";
import type { Preferences, SavedSurfaceTemplate } from "../platform/preferences.js";
import { findSurfaceTemplate, SURFACE_TEMPLATE_REGISTRY, type SurfaceTemplateDefinition } from "./surface-templates.js";

/** A pillar entry: a built-in template rendered as-is, or a user-saved one resolved back to the built-in content it reuses. */
export interface SurfaceTemplateEntry {
	id: string;
	title: string;
	icon: SurfaceTemplateDefinition["icon"];
	dockCommandId: string;
	templateId: string;
	saved: boolean;
}

export interface SurfaceTemplatesHandle {
	entries: SurfaceTemplateEntry[];
	saveAsTemplate: (title: string, templateId: string) => void;
	removeSavedTemplate: (savedId: string) => void;
}

let savedIdCounter = 0;

function builtinEntries(): SurfaceTemplateEntry[] {
	return SURFACE_TEMPLATE_REGISTRY.map((template) => ({
		id: template.id,
		title: template.title,
		icon: template.icon,
		dockCommandId: template.dockCommandId,
		templateId: template.id,
		saved: false,
	}));
}

function savedEntries(saved: readonly SavedSurfaceTemplate[]): SurfaceTemplateEntry[] {
	const entries: SurfaceTemplateEntry[] = [];
	for (const template of saved) {
		const source = findSurfaceTemplate(template.templateId);
		if (!source) continue; // a saved template naming a since-removed built-in template is silently dropped from the pillar, not a crash
		entries.push({ id: template.id, title: template.title, icon: source.icon, dockCommandId: source.dockCommandId, templateId: template.templateId, saved: true });
	}
	return entries;
}

/** Owns the Surface Templates pillar's contents: the fixed built-in catalog plus user-saved templates, persisted via the Preferences port. */
export function useSurfaceTemplates(preferences: Preferences): SurfaceTemplatesHandle {
	const [saved, setSaved] = useState<SavedSurfaceTemplate[]>(() => preferences.savedSurfaceTemplates());

	function persist(next: SavedSurfaceTemplate[]): void {
		setSaved(next);
		preferences.setSavedSurfaceTemplates(next);
	}

	return {
		entries: [...builtinEntries(), ...savedEntries(saved)],
		saveAsTemplate(title, templateId) {
			const trimmed = title.trim();
			if (!trimmed || !findSurfaceTemplate(templateId)) return;
			savedIdCounter += 1;
			persist([...saved, { id: `saved-${savedIdCounter}`, title: trimmed, templateId }]);
		},
		removeSavedTemplate(savedId) {
			persist(saved.filter((template) => template.id !== savedId));
		},
	};
}
