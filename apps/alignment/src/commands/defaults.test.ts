import { describe, expect, it, vi } from "vitest";
import { createExtensionHost } from "../extensions/extension-host.js";
import { createAlignmentCommandRegistry, type AlignmentCommandActions } from "./defaults.js";

function noopActions(): AlignmentCommandActions {
	return {
		toggleWorkspaceSelection: vi.fn(),
		focusWorkspaceSelection: vi.fn(),
		focusCanvas: vi.fn(),
		selectPreviousWorkspace: vi.fn(),
		selectNextWorkspace: vi.fn(),
		selectFirstWorkspace: vi.fn(),
		selectLastWorkspace: vi.fn(),
		selectWorkspace: vi.fn(),
		cycleTheme: vi.fn(),
		sendMessage: vi.fn(),
		openPalette: vi.fn(),
		openShortcuts: vi.fn(),
		closeDialog: vi.fn(),
		openConversation: vi.fn(),
		canSendMessage: () => true,
		nextWindow: vi.fn(),
		previousWindow: vi.fn(),
		newWindow: vi.fn(),
		toggleChat: vi.fn(),
		openTemplatesPicker: vi.fn(),
		openTemplatesGallery: vi.fn(),
		dockDefaultTemplate: vi.fn(),
		openAppearance: vi.fn(),
	};
}

describe("createAlignmentCommandRegistry with an ExtensionHost", () => {
	it("an extension's registerCommand call genuinely reaches the real command registry and is executable end-to-end", () => {
		const host = createExtensionHost();
		const execute = vi.fn();
		host.registerExtension({ id: "acme", activate: (api) => api.registerCommand({ id: "acme.doThing", title: "Do the thing", description: "d", execute }) });

		const registry = createAlignmentCommandRegistry(noopActions(), [], host.commands());

		expect(registry.commands().some((command) => command.id === "acme.doThing")).toBe(true);
		expect(registry.execute("acme.doThing")).toBe(true);
		expect(execute).toHaveBeenCalledOnce();
	});

	it("built-in commands still work unchanged when no extension contributes anything", () => {
		const registry = createAlignmentCommandRegistry(noopActions());
		expect(registry.commands().some((command) => command.id === "palette.open")).toBe(true);
	});
});
