import { describe, expect, it } from "vitest";
import {
	assertNeverZodiacAgentEvent,
	isSupportedZodiacAgentEvent,
	isZodiacAgentEvent,
	ZODIAC_AGENT_EVENT_MIN_VERSION,
	ZODIAC_AGENT_EVENT_PROTOCOL_VERSION,
	type ZodiacAgentEvent,
} from "./port.js";

describe("assertNeverZodiacAgentEvent", () => {
	it("throws with the offending value's JSON, never returns normally -- reachable only when a caller's own switch/if-chain omits a real ZodiacAgentEvent variant", () => {
		const unhandled = { type: "agent-start" } as unknown as never;
		expect(() => assertNeverZodiacAgentEvent(unhandled)).toThrow(/Unhandled ZodiacAgentEvent/);
	});

	it("every ZodiacAgentEvent variant is a plain, JSON-serializable object -- the exhaustiveness guard's own error message depends on this remaining true", () => {
		const sample: ZodiacAgentEvent = { type: "assistant-message-delta", text: "hi" };
		expect(() => JSON.stringify(sample)).not.toThrow();
	});
});

describe("ZodiacAgentEvent runtime boundary", () => {
	it("accepts known additive variants and rejects unknown/session-exited discriminants", () => {
		expect(isZodiacAgentEvent({ type: "turn-start" })).toBe(true);
		expect(isZodiacAgentEvent({ type: "session-exited" })).toBe(false);
		expect(isZodiacAgentEvent({ type: "future-unbounded-event" })).toBe(false);
	});
});

describe("ZodiacAgentEvent version/capability negotiation", () => {
	it("every real variant records a minimum version at or below the port's current version", () => {
		for (const type of Object.keys(ZODIAC_AGENT_EVENT_MIN_VERSION) as (keyof typeof ZODIAC_AGENT_EVENT_MIN_VERSION)[]) {
			expect(ZODIAC_AGENT_EVENT_MIN_VERSION[type]).toBeLessThanOrEqual(ZODIAC_AGENT_EVENT_PROTOCOL_VERSION);
		}
	});

	it("isSupportedZodiacAgentEvent accepts a real event when the consumer declares support for its minimum version", () => {
		const event: ZodiacAgentEvent = { type: "agent-start" };
		expect(isSupportedZodiacAgentEvent(event, ZODIAC_AGENT_EVENT_PROTOCOL_VERSION)).toBe(true);
	});

	it("records the richer turn, tool-progress, compaction, and session-info vocabulary as version 2", () => {
		expect(ZODIAC_AGENT_EVENT_PROTOCOL_VERSION).toBe(2);
		expect(ZODIAC_AGENT_EVENT_MIN_VERSION).toMatchObject({
			"turn-start": 2,
			"turn-end": 2,
			"tool-call-update": 2,
			"compaction-start": 2,
			"compaction-end": 2,
			"session-info-changed": 2,
		});
	});

	it("isSupportedZodiacAgentEvent fails loud (returns false, doesn't throw or guess) for a real event whose variant requires a newer port version than the consumer declares", () => {
		const event: ZodiacAgentEvent = { type: "agent-start" };
		// A hypothetical consumer stuck on port version 0 -- older than every
		// real variant's own recorded minimum -- must skip/degrade this event
		// rather than project it into a UI it wasn't built to render.
		expect(isSupportedZodiacAgentEvent(event, 0)).toBe(false);
	});
});
