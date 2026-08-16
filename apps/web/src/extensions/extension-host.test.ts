import { describe, expect, it, vi } from "vitest";
import { Activity } from "lucide-react";
import { integrationId } from "@zodiac/protocol";
import { createExtensionHost } from "./extension-host.js";
import type { ZodiacExtension } from "./types.js";

function extension(id: string, activate: ZodiacExtension["activate"]): ZodiacExtension {
	return { id, activate };
}

function fakeTemplate(id: string) {
	return { integrationId: integrationId(id), title: id, icon: Activity, dockCommandId: `dock.${id}`, dockCommandTitle: id, dockCommandDescription: "", render: () => null };
}

function fakeCommand(id: string) {
	return { id, title: id, description: "", execute: vi.fn() };
}

describe("createExtensionHost", () => {
	it("starts with no contributed Surface Templates or commands", () => {
		const host = createExtensionHost();
		expect(host.surfaceTemplates()).toEqual([]);
		expect(host.commands()).toEqual([]);
	});

	it("registerExtension runs activate, contributing whatever it registers", () => {
		const host = createExtensionHost();
		host.registerExtension(
			extension("acme", (api) => {
				api.registerSurfaceTemplate(fakeTemplate("acme-surface"));
				api.registerCommand(fakeCommand("acme.doThing"));
			}),
		);
		expect(host.surfaceTemplates().map((t) => t.integrationId)).toEqual(["acme-surface"]);
		expect(host.commands().map((c) => c.id)).toEqual(["acme.doThing"]);
	});

	it("rejects registering the same extension id twice", () => {
		const host = createExtensionHost();
		const ext = extension("acme", () => {});
		host.registerExtension(ext);
		expect(() => host.registerExtension(ext)).toThrow(/already registered/i);
	});

	it("rejects a duplicate Surface Template id across extensions", () => {
		const host = createExtensionHost();
		host.registerExtension(extension("a", (api) => api.registerSurfaceTemplate(fakeTemplate("dup"))));
		expect(() => host.registerExtension(extension("b", (api) => api.registerSurfaceTemplate(fakeTemplate("dup"))))).toThrow(/duplicate surface template/i);
	});

	it("rejects a duplicate command id across extensions", () => {
		const host = createExtensionHost();
		host.registerExtension(extension("a", (api) => api.registerCommand(fakeCommand("dup"))));
		expect(() => host.registerExtension(extension("b", (api) => api.registerCommand(fakeCommand("dup"))))).toThrow(/duplicate command/i);
	});

	it("multiple extensions' contributions all accumulate", () => {
		const host = createExtensionHost();
		host.registerExtension(extension("a", (api) => api.registerCommand(fakeCommand("a.cmd"))));
		host.registerExtension(extension("b", (api) => api.registerCommand(fakeCommand("b.cmd"))));
		expect(host.commands().map((c) => c.id)).toEqual(["a.cmd", "b.cmd"]);
	});

	describe("lifecycle events", () => {
		it("on() subscribes a handler that emit() invokes with the exact event", () => {
			const host = createExtensionHost();
			const handler = vi.fn();
			host.registerExtension(extension("a", (api) => api.on("workspace:selected", handler)));

			host.emit({ type: "workspace:selected", workspaceId: "w1" });
			expect(handler).toHaveBeenCalledWith({ type: "workspace:selected", workspaceId: "w1" });
		});

		it("a handler for one event type never fires for another", () => {
			const host = createExtensionHost();
			const dockedHandler = vi.fn();
			host.registerExtension(extension("a", (api) => api.on("surface:docked", dockedHandler)));

			host.emit({ type: "workspace:selected", workspaceId: "w1" });
			expect(dockedHandler).not.toHaveBeenCalled();
		});

		it("the unsubscribe function returned by on() stops future delivery", () => {
			const host = createExtensionHost();
			const handler = vi.fn();
			let unsubscribe: () => void = () => {};
			host.registerExtension(
				extension("a", (api) => {
					unsubscribe = api.on("workspace:selected", handler);
				}),
			);

			unsubscribe();
			host.emit({ type: "workspace:selected", workspaceId: "w1" });
			expect(handler).not.toHaveBeenCalled();
		});

		it("emitting with no subscribers is a safe no-op", () => {
			const host = createExtensionHost();
			expect(() => host.emit({ type: "workspace:selected", workspaceId: "w1" })).not.toThrow();
		});
	});
});
