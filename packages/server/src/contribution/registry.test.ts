import { describe, expect, it, vi } from "vitest";
import { createContributionRegistry, type Contribution } from "./registry.js";

interface FakeIntegration {
	id: string;
}
interface FakeCommand {
	id: string;
}
type FakeEvent = { type: "selected"; id: string } | { type: "docked"; id: string };

function contribution(id: string, activate: Contribution<FakeIntegration, FakeCommand, FakeEvent>["activate"]): Contribution<FakeIntegration, FakeCommand, FakeEvent> {
	return { id, activate };
}

describe("createContributionRegistry", () => {
	it("starts with no contributed Integrations or commands", () => {
		const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
		expect(registry.integrations()).toEqual([]);
		expect(registry.commands()).toEqual([]);
	});

	it("register runs activate, contributing whatever it registers", () => {
		const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
		registry.register(
			contribution("acme", (api) => {
				api.registerIntegration({ id: "acme-integration" });
				api.registerCommand({ id: "acme.doThing" });
			}),
		);
		expect(registry.integrations().map((t) => t.id)).toEqual(["acme-integration"]);
		expect(registry.commands().map((c) => c.id)).toEqual(["acme.doThing"]);
	});

	it("rejects registering the same contribution id twice", () => {
		const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
		const c = contribution("acme", () => {});
		registry.register(c);
		expect(() => registry.register(c)).toThrow(/already registered/i);
	});

	it("rejects a duplicate Integration id across contributions", () => {
		const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
		registry.register(contribution("a", (api) => api.registerIntegration({ id: "dup" })));
		expect(() => registry.register(contribution("b", (api) => api.registerIntegration({ id: "dup" })))).toThrow(/duplicate integration/i);
	});

	it("rejects a duplicate command id across contributions", () => {
		const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
		registry.register(contribution("a", (api) => api.registerCommand({ id: "dup" })));
		expect(() => registry.register(contribution("b", (api) => api.registerCommand({ id: "dup" })))).toThrow(/duplicate command/i);
	});

	describe("lifecycle events", () => {
		it("on() subscribes a handler that emit() invokes with the exact event", () => {
			const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
			const handler = vi.fn();
			registry.register(contribution("a", (api) => api.on("selected", handler)));

			registry.emit({ type: "selected", id: "w1" });
			expect(handler).toHaveBeenCalledWith({ type: "selected", id: "w1" });
		});

		it("a handler for one event type never fires for another", () => {
			const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
			const dockedHandler = vi.fn();
			registry.register(contribution("a", (api) => api.on("docked", dockedHandler)));

			registry.emit({ type: "selected", id: "w1" });
			expect(dockedHandler).not.toHaveBeenCalled();
		});

		it("the unsubscribe function returned by on() stops future delivery", () => {
			const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
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
			const registry = createContributionRegistry<FakeIntegration, FakeCommand, FakeEvent>();
			expect(() => registry.emit({ type: "selected", id: "w1" })).not.toThrow();
		});
	});
});
