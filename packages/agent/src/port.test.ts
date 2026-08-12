import { describe, expect, it } from "vitest";
import { assertNeverZodiacAgentEvent, type ZodiacAgentEvent } from "./port.js";

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
