import { describe, expect, it, vi } from "vitest";
import { createContributionRegistry, type Contribution } from "./registry.js";

interface FakeTemplate {
	id: string;
}
interface FakeCommand {
	id: string;
}
type FakeEvent = { type: "selected"; id: string } | { type: "docked"; id: string };

function contribution(id: string, activate: Contribution<FakeTemplate, FakeCommand, FakeEvent>["activate"]): Contribution<FakeTemplate, FakeCommand, FakeEvent> {
	return { id, activate };
}

describe("createContributionRegistry", () => {
	it("starts with no contributed Surface Templates or commands", () => {
		const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
		expect(registry.surfaceTemplates()).toEqual([]);
		expect(registry.commands()).toEqual([]);
	});

	it("register runs activate, contributing whatever it registers", () => {
		const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
		registry.register(
			contribution("acme", (api) => {
				api.registerSurfaceTemplate({ id: "acme-surface" });
				api.registerCommand({ id: "acme.doThing" });
			}),
		);
		expect(registry.surfaceTemplates().map((t) => t.id)).toEqual(["acme-surface"]);
		expect(registry.commands().map((c) => c.id)).toEqual(["acme.doThing"]);
	});

	it("rejects registering the same contribution id twice", () => {
		const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
		const c = contribution("acme", () => {});
		registry.register(c);
		expect(() => registry.register(c)).toThrow(/already registered/i);
	});

	it("rejects a duplicate Surface Template id across contributions", () => {
		const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
		registry.register(contribution("a", (api) => api.registerSurfaceTemplate({ id: "dup" })));
		expect(() => registry.register(contribution("b", (api) => api.registerSurfaceTemplate({ id: "dup" })))).toThrow(/duplicate surface template/i);
	});

	it("rejects a duplicate command id across contributions", () => {
		const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
		registry.register(contribution("a", (api) => api.registerCommand({ id: "dup" })));
		expect(() => registry.register(contribution("b", (api) => api.registerCommand({ id: "dup" })))).toThrow(/duplicate command/i);
	});

	describe("lifecycle events", () => {
		it("on() subscribes a handler that emit() invokes with the exact event", () => {
			const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
			const handler = vi.fn();
			registry.register(contribution("a", (api) => api.on("selected", handler)));

			registry.emit({ type: "selected", id: "w1" });
			expect(handler).toHaveBeenCalledWith({ type: "selected", id: "w1" });
		});

		it("a handler for one event type never fires for another", () => {
			const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
			const dockedHandler = vi.fn();
			registry.register(contribution("a", (api) => api.on("docked", dockedHandler)));

			registry.emit({ type: "selected", id: "w1" });
			expect(dockedHandler).not.toHaveBeenCalled();
		});

		it("the unsubscribe function returned by on() stops future delivery", () => {
			const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
			const handler = vi.fn();
			let unsubscribe: () => void = () => {};
			registry.register(
				contribution("a", (api) => {
					unsubscribe = api.on("selected", handler);
				}),
			);

			unsubscribe();
			registry.emit({ type: "selected", id: "w1" });
			expect(handler).not.toHaveBeenCalled();
		});

		it("emitting with no subscribers is a safe no-op", () => {
			const registry = createContributionRegistry<FakeTemplate, FakeCommand, FakeEvent>();
			expect(() => registry.emit({ type: "selected", id: "w1" })).not.toThrow();
		});
	});
});
