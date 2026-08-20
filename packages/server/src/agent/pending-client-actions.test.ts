import { describe, expect, it } from "vitest";
import { createPendingClientActions, NoClientObservedError } from "./pending-client-actions.js";

describe("createPendingClientActions", () => {
	it("resolve() delivers its own result to the matching register()'s own Promise", async () => {
		const pending = createPendingClientActions();
		const promise = pending.register("call-1", 1_000);
		const delivered = pending.resolve("call-1", { cues: [{ id: "a" }] });
		expect(delivered).toBe(true);
		await expect(promise).resolves.toEqual({ cues: [{ id: "a" }] });
	});

	it("resolve() for a toolCallId nothing is pending under is a no-op, not an error -- a late or duplicate POST is a real, expected race", () => {
		const pending = createPendingClientActions();
		expect(pending.resolve("never-registered", {})).toBe(false);
	});

	it("register() rejects with a real NoClientObservedError once its own timeout elapses with nothing posted -- distinct from resolving with an empty/falsy result", async () => {
		const pending = createPendingClientActions();
		const promise = pending.register("call-2", 10);
		await expect(promise).rejects.toBeInstanceOf(NoClientObservedError);
		await expect(promise).rejects.toThrow(/call-2/);
	});

	it("resolving with an explicit empty array is a genuinely different outcome from a timeout -- both are real, distinguishable results", async () => {
		const pending = createPendingClientActions();
		const promise = pending.register("call-3", 1_000);
		pending.resolve("call-3", []);
		await expect(promise).resolves.toEqual([]);
	});

	it("two concurrent registrations under different toolCallIds resolve independently", async () => {
		const pending = createPendingClientActions();
		const first = pending.register("call-a", 1_000);
		const second = pending.register("call-b", 1_000);
		pending.resolve("call-b", "b-result");
		pending.resolve("call-a", "a-result");
		await expect(first).resolves.toBe("a-result");
		await expect(second).resolves.toBe("b-result");
	});
});
