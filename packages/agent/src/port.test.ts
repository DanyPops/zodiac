import { describe, expect, it } from "vitest";
import {
	AgentSessionControlOutcomeSchema,
	assertNeverZodiacAgentEvent,
	isSupportedZodiacAgentEvent,
	isZodiacAgentEvent,
	ZodiacAgentEventSchema,
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

describe("ZodiacAgentEventSchema", () => {
	it("accepts every real variant, matching isZodiacAgentEvent's own recognized set", () => {
		const samples: ZodiacAgentEvent[] = [
			{ type: "agent-start" },
			{ type: "agent-settled" },
			{ type: "assistant-message-delta", text: "hi" },
			{ type: "tool-call-start", toolCallId: "t1", toolName: "read", input: { path: "a.ts" } },
			{ type: "tool-call-end", toolCallId: "t1", toolName: "read", output: "contents", isError: false },
			{ type: "compaction-end", reason: "threshold", aborted: false },
			{ type: "session-info-changed", name: "My Session" },
			{ type: "error", message: "boom" },
		];
		for (const sample of samples) expect(ZodiacAgentEventSchema.safeParse(sample).success).toBe(true);
	});

	it("rejects a recognized type with a missing required field -- the real gap isZodiacAgentEvent's own type-only check leaves open", () => {
		expect(ZodiacAgentEventSchema.safeParse({ type: "tool-call-start", toolCallId: "t1" }).success).toBe(false);
		expect(ZodiacAgentEventSchema.safeParse({ type: "assistant-message-delta" }).success).toBe(false);
	});

	it("rejects an unrecognized type", () => {
		expect(ZodiacAgentEventSchema.safeParse({ type: "session-exited" }).success).toBe(false);
	});
});

describe("AgentSessionControlOutcomeSchema", () => {
	it("accepts a success outcome with no other fields", () => {
		expect(AgentSessionControlOutcomeSchema.safeParse({ ok: true }).success).toBe(true);
	});

	it("accepts a real failure outcome", () => {
		expect(AgentSessionControlOutcomeSchema.safeParse({ ok: false, reason: "model-not-found", message: "gpt-9 does not exist" }).success).toBe(true);
	});

	it("rejects a failure outcome with an unrecognized reason", () => {
		expect(AgentSessionControlOutcomeSchema.safeParse({ ok: false, reason: "made-up-reason", message: "x" }).success).toBe(false);
	});

	it("rejects a completely malformed payload", () => {
		expect(AgentSessionControlOutcomeSchema.safeParse("not-an-object").success).toBe(false);
		expect(AgentSessionControlOutcomeSchema.safeParse(null).success).toBe(false);
	});
});
