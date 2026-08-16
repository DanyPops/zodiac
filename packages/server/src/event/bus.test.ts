import { describe, expect, it } from "vitest";
import { createEventBus } from "./bus.js";
import type { BusMessage } from "./bus.js";

/**
 * Walking-skeleton event bus: proves the three-channel (command/event/
 * notification) pub-sub shape the World and its future subscribers (Agent
 * Integrations, multi-host sync) will build on -- publish/subscribe per
 * channel, wildcard subscription, deterministic unsubscribe, deterministic
 * delivery order, and bounded listener caps that fail as typed values, not
 * thrown exceptions.
 */
describe("createEventBus", () => {
	it("delivers a published message only to subscribers on the same channel and the same type", () => {
		const bus = createEventBus();
		const onCommand: BusMessage[] = [];
		const onEvent: BusMessage[] = [];
		bus.subscribe("command", "surface.dock", (message) => onCommand.push(message));
		bus.subscribe("event", "surface.dock", (message) => onEvent.push(message));

		bus.publish("command", { type: "surface.dock", correlationId: "c1", payload: { workspaceId: "w1" } });

		expect(onCommand).toHaveLength(1);
		expect(onEvent).toHaveLength(0);
	});

	it("does not deliver a message to a subscriber of a different type on the same channel", () => {
		const bus = createEventBus();
		const received: BusMessage[] = [];
		bus.subscribe("event", "surface.dock", (message) => received.push(message));

		bus.publish("event", { type: "surface.undock", correlationId: "c1", payload: {} });

		expect(received).toHaveLength(0);
	});

	it("stamps a published message with a timestamp and elapsed-since-first-seen-for-correlation", () => {
		const bus = createEventBus();
		const received: BusMessage[] = [];
		bus.subscribe("event", "surface.dock", (message) => received.push(message));

		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(received).toHaveLength(1);
		expect(typeof received[0]?.timestamp).toBe("number");
		expect(received[0]?.elapsed).toBe(0);
	});

	it("onAny delivers every message on the channel regardless of type", () => {
		const bus = createEventBus();
		const received: string[] = [];
		bus.onAny("notification", (message) => received.push(message.type));

		bus.publish("notification", { type: "toast.shown", correlationId: "c1", payload: {} });
		bus.publish("notification", { type: "toast.dismissed", correlationId: "c1", payload: {} });

		expect(received).toEqual(["toast.shown", "toast.dismissed"]);
	});

	it("does not deliver a notification-channel message to an event-channel wildcard subscriber", () => {
		const bus = createEventBus();
		const received: string[] = [];
		bus.onAny("event", (message) => received.push(message.type));

		bus.publish("notification", { type: "toast.shown", correlationId: "c1", payload: {} });

		expect(received).toHaveLength(0);
	});

	it("unsubscribe deterministically stops further delivery without affecting other subscribers", () => {
		const bus = createEventBus();
		const first: string[] = [];
		const second: string[] = [];
		const subscription = bus.subscribe("event", "surface.dock", () => first.push("fired"));
		bus.subscribe("event", "surface.dock", () => second.push("fired"));
		if (!subscription.ok) throw new Error("expected subscription to succeed");
		subscription.value();

		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(first).toEqual([]);
		expect(second).toEqual(["fired"]);
	});

	it("calling the returned unsubscribe function more than once is a no-op", () => {
		const bus = createEventBus();
		const received: string[] = [];
		const subscription = bus.subscribe("event", "surface.dock", () => received.push("fired"));
		if (!subscription.ok) throw new Error("expected subscription to succeed");

		subscription.value();
		subscription.value();
		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(received).toEqual([]);
	});

	it("delivers to multiple specific-type subscribers in deterministic subscription order", () => {
		const bus = createEventBus();
		const order: string[] = [];
		bus.subscribe("event", "surface.dock", () => order.push("a"));
		bus.subscribe("event", "surface.dock", () => order.push("b"));
		bus.subscribe("event", "surface.dock", () => order.push("c"));

		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(order).toEqual(["a", "b", "c"]);
	});

	it("delivers to specific-type subscribers before wildcard subscribers, in a fixed deterministic order", () => {
		const bus = createEventBus();
		const order: string[] = [];
		bus.onAny("event", () => order.push("wildcard"));
		bus.subscribe("event", "surface.dock", () => order.push("specific"));

		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(order).toEqual(["specific", "wildcard"]);
	});

	it("returns a typed failure instead of throwing once a channel/type's listener cap is exceeded", () => {
		const bus = createEventBus({ maxListenersPerType: 2 });
		const first = bus.subscribe("event", "surface.dock", () => {});
		const second = bus.subscribe("event", "surface.dock", () => {});
		const third = bus.subscribe("event", "surface.dock", () => {});

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		expect(third).toEqual({ ok: false, reason: "listener-limit-exceeded", limit: 2 });
	});

	it("enforces the listener cap on wildcard subscriptions independently per channel", () => {
		const bus = createEventBus({ maxListenersPerType: 1 });
		const first = bus.onAny("notification", () => {});
		const second = bus.onAny("notification", () => {});

		expect(first.ok).toBe(true);
		expect(second).toEqual({ ok: false, reason: "listener-limit-exceeded", limit: 1 });
	});

	it("frees a listener slot once unsubscribed, allowing a new subscription past a previously-hit cap", () => {
		const bus = createEventBus({ maxListenersPerType: 1 });
		const first = bus.subscribe("event", "surface.dock", () => {});
		if (!first.ok) throw new Error("expected first subscription to succeed");
		first.value();

		const second = bus.subscribe("event", "surface.dock", () => {});

		expect(second.ok).toBe(true);
	});

	it("reports the current listener count for a channel/type pair", () => {
		const bus = createEventBus();
		expect(bus.listenerCount("command", "surface.dock")).toBe(0);
		bus.subscribe("command", "surface.dock", () => {});
		bus.subscribe("command", "surface.dock", () => {});
		expect(bus.listenerCount("command", "surface.dock")).toBe(2);
	});

	it("evicts the oldest tracked correlation once maxTrackedCorrelations is exceeded, without throwing", () => {
		const bus = createEventBus({ maxTrackedCorrelations: 2 });
		const received: number[] = [];
		bus.subscribe("event", "tick", (message) => received.push(message.elapsed));

		bus.publish("event", { type: "tick", correlationId: "c1", payload: {} });
		bus.publish("event", { type: "tick", correlationId: "c2", payload: {} });
		bus.publish("event", { type: "tick", correlationId: "c3", payload: {} }); // evicts c1's bookkeeping
		bus.publish("event", { type: "tick", correlationId: "c1", payload: {} }); // c1 is "new" again -> elapsed resets to 0

		expect(received).toEqual([0, 0, 0, 0]);
	});

	it("tracks first-seen correlations independently per channel", () => {
		const bus = createEventBus();
		const received: number[] = [];
		bus.onAny("command", (message) => received.push(message.elapsed));
		bus.onAny("event", (message) => received.push(message.elapsed));

		bus.publish("command", { type: "surface.dock", correlationId: "c1", payload: {} });
		bus.publish("event", { type: "surface.dock", correlationId: "c1", payload: {} });

		expect(received).toEqual([0, 0]);
	});
});
