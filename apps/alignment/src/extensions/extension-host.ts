import type { CommandDefinition } from "../commands/registry.js";
import type { SurfaceTemplateDefinition } from "../workspace/surface-templates.js";
import type { AlignmentExtension, AlignmentExtensionAPI, WorkspaceLifecycleEvent } from "./types.js";

export interface ExtensionHost {
	registerExtension: (extension: AlignmentExtension) => void;
	emit: (event: WorkspaceLifecycleEvent) => void;
	surfaceTemplates: () => readonly SurfaceTemplateDefinition[];
	commands: () => readonly CommandDefinition[];
}

/**
 * Runtime registry an AlignmentExtension activates into. Deliberately
 * scoped to registration + lifecycle events only: discovery (finding
 * extensions to load) and a real sandboxed execution boundary are out of
 * scope here -- an extension today is a plain in-process object a caller
 * already holds a reference to, activated with the same trust as the
 * app's own built-ins, not loaded from an untrusted source.
 */
export function createExtensionHost(): ExtensionHost {
	const surfaceTemplates: SurfaceTemplateDefinition[] = [];
	const commands: CommandDefinition[] = [];
	const listeners = new Map<WorkspaceLifecycleEvent["type"], Set<(event: WorkspaceLifecycleEvent) => void>>();
	const registeredExtensionIds = new Set<string>();

	const api: AlignmentExtensionAPI = {
		registerSurfaceTemplate(definition) {
			if (surfaceTemplates.some((existing) => existing.id === definition.id)) throw new Error(`Duplicate Surface Template id: ${definition.id}`);
			surfaceTemplates.push(definition);
		},
		registerCommand(definition) {
			if (commands.some((existing) => existing.id === definition.id)) throw new Error(`Duplicate command id: ${definition.id}`);
			commands.push(definition);
		},
		on(type, handler) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			const wrapped = handler as (event: WorkspaceLifecycleEvent) => void;
			set.add(wrapped);
			return () => set.delete(wrapped);
		},
	};

	return {
		registerExtension(extension) {
			if (registeredExtensionIds.has(extension.id)) throw new Error(`Extension "${extension.id}" is already registered`);
			registeredExtensionIds.add(extension.id);
			extension.activate(api);
		},
		emit(event) {
			for (const handler of listeners.get(event.type) ?? []) handler(event);
		},
		surfaceTemplates: () => [...surfaceTemplates],
		commands: () => [...commands],
	};
}
