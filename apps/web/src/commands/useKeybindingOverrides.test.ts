/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPreferences } from "../platform/preferences.js";
import { createZodiacCommandRegistry, type ZodiacCommandActions } from "./defaults.js";
import { useKeybindingOverrides } from "./useKeybindingOverrides.js";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
		removeItem: (key) => void values.delete(key),
		clear: () => values.clear(),
		key: () => null,
		get length() {
			return values.size;
		},
	};
}

/** The full first-slice command set, so rebind validation sees every default binding it must not collide with. */
function fullCommandSet() {
	const noop = vi.fn();
	const actions: ZodiacCommandActions = {
		toggleWorkspaceSelection: noop,
		focusWorkspaceSelection: noop,
		focusCanvas: noop,
		selectPreviousWorkspace: noop,
		selectNextWorkspace: noop,
		selectFirstWorkspace: noop,
		selectLastWorkspace: noop,
		selectWorkspace: noop,
		cycleTheme: noop,
		sendMessage: noop,
		openPalette: noop,
		openShortcuts: noop,
		closeDialog: noop,
		openConversation: noop,
		canSendMessage: () => true,
		nextWindow: noop,
		previousWindow: noop,
		newWindow: noop,
		toggleChat: noop,
		openTemplatesPicker: noop,
		openTemplatesGallery: noop,
		dockDefaultTemplate: noop,
		openAppearance: noop,
	};
	return createZodiacCommandRegistry(actions).commands();
}

describe("useKeybindingOverrides", () => {
	it("rejects rebinding an unknown command", () => {
		const { result } = renderHook(() => useKeybindingOverrides(createPreferences(memoryStorage())));
		const error = result.current.rebind("nope.command", "Mod+P", fullCommandSet());
		expect(error).toMatch(/not bindable/);
	});

	it("rejects a rebind that would conflict with another command in the same context", () => {
		const { result } = renderHook(() => useKeybindingOverrides(createPreferences(memoryStorage())));
		const error = result.current.rebind("palette.open", "Mod+/", fullCommandSet());
		expect(error).toMatch(/conflict/i);
	});

	it("accepts a valid rebind, persists it, and returns no error", () => {
		const storage = memoryStorage();
		const preferences = createPreferences(storage);
		const { result } = renderHook(() => useKeybindingOverrides(preferences));

		let error: string | undefined;
		act(() => {
			error = result.current.rebind("palette.open", "Mod+P", fullCommandSet());
		});

		expect(error).toBeUndefined();
		expect(result.current.userBindings).toContainEqual(expect.objectContaining({ commandId: "palette.open", keys: "Mod+P" }));
		expect(preferences.keybindingOverrides()).toContainEqual(expect.objectContaining({ commandId: "palette.open", keys: "Mod+P" }));
	});
});
