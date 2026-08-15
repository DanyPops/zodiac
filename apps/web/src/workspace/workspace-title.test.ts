import type { ZodiacAgentEvent } from "@zodiac/agent";
import { describe, expect, it, vi } from "vitest";
import type { PiClient } from "../pi/client.js";
import { clampTitleWords, createLlmWorkspaceTitleGenerator, createPiWorkspaceTitleComplete, provisionalTitleFromText } from "./workspace-title.js";

describe("clampTitleWords", () => {
	it("keeps two to five words", () => {
		expect(clampTitleWords("Fix picker")).toBe("Fix picker");
		expect(clampTitleWords("a b c d e f")).toBe("a b c d e");
	});

	it("strips quotes and trailing punctuation", () => {
		expect(clampTitleWords('"Codebase explore path."')).toBe("Codebase explore path");
	});

	it("rejects slash/colon commands and single words", () => {
		expect(clampTitleWords(":compact now")).toBeUndefined();
		expect(clampTitleWords("/tickets open")).toBeUndefined();
		expect(clampTitleWords("Alone")).toBeUndefined();
	});
});

describe("provisionalTitleFromText", () => {
	it("is a thin alias for clampTitleWords", () => {
		expect(provisionalTitleFromText("Deploy the staging environment")).toBe("Deploy the staging environment");
	});
});

describe("createLlmWorkspaceTitleGenerator", () => {
	it("clamps the model reply to five words", async () => {
		const complete = vi.fn(async () => "Deep multi agent codebase exploration journey");
		const titleFromPrompt = createLlmWorkspaceTitleGenerator(complete);
		await expect(titleFromPrompt("Explore the code base using multiple agents.")).resolves.toBe("Deep multi agent codebase exploration");
		expect(complete).toHaveBeenCalledOnce();
	});

	it("falls back to the heuristic when the model call throws", async () => {
		const titleFromPrompt = createLlmWorkspaceTitleGenerator(async () => {
			throw new Error("offline");
		});
		await expect(titleFromPrompt("Explore the code base using multiple agents.")).resolves.toBe("Explore the code base using");
	});

	it("falls back when the model returns a one-word answer", async () => {
		const titleFromPrompt = createLlmWorkspaceTitleGenerator(async () => "Explore");
		await expect(titleFromPrompt("Explore the code base tonight")).resolves.toBe("Explore the code base tonight");
	});

	it("returns the heuristic fallback for a blank prompt without ever calling complete", async () => {
		const complete = vi.fn(async () => "irrelevant");
		const titleFromPrompt = createLlmWorkspaceTitleGenerator(complete);
		await expect(titleFromPrompt("   ")).resolves.toBeUndefined();
		expect(complete).not.toHaveBeenCalled();
	});

	it("only reads the reply's first line, ignoring any trailing explanation", async () => {
		const titleFromPrompt = createLlmWorkspaceTitleGenerator(async () => "Fix flaky CI pipeline\nThis title reflects the user's request.");
		await expect(titleFromPrompt("Please fix the flaky CI pipeline")).resolves.toBe("Fix flaky CI pipeline");
	});
});

/** Mirrors pi-chat-controller.test.ts's own fakeClient exactly -- the established PiClient test-double convention. */
function fakeClient(): PiClient & { emit(event: ZodiacAgentEvent): void } {
	let listener: ((event: ZodiacAgentEvent) => void) | undefined;
	return {
		createSession: vi.fn(async () => "naming-session-1"),
		sendPrompt: vi.fn(async () => {}),
		abort: vi.fn(async () => {}),
		streamEvents: vi.fn((_sessionId, onEvent) => {
			listener = onEvent;
			return () => {
				listener = undefined;
			};
		}),
		emit(event) {
			listener?.(event);
		},
	};
}

describe("createPiWorkspaceTitleComplete", () => {
	it("resolves with the assistant's first completed reply, then aborts and unsubscribes the throwaway session", async () => {
		const client = fakeClient();
		const complete = createPiWorkspaceTitleComplete(client);

		const resultPromise = complete("Name this conversation...");
		await vi.waitFor(() => expect(client.sendPrompt).toHaveBeenCalledWith("naming-session-1", "Name this conversation..."));

		client.emit({ type: "assistant-message-end", text: "Deploy staging fix" });

		await expect(resultPromise).resolves.toBe("Deploy staging fix");
		expect(client.abort).toHaveBeenCalledWith("naming-session-1");
	});

	it("waits for assistant-message-end, not an in-progress assistant-message-delta", async () => {
		const client = fakeClient();
		const complete = createPiWorkspaceTitleComplete(client);

		const resultPromise = complete("Name this conversation...");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "assistant-message-start" });
		client.emit({ type: "assistant-message-delta", text: "Deploy staging" });
		client.emit({ type: "assistant-message-end", text: "Deploy staging fix" });

		await expect(resultPromise).resolves.toBe("Deploy staging fix");
	});

	it("rejects when Pi reports an error event", async () => {
		const client = fakeClient();
		const complete = createPiWorkspaceTitleComplete(client);

		const resultPromise = complete("Name this conversation...");
		await vi.waitFor(() => expect(client.streamEvents).toHaveBeenCalled());

		client.emit({ type: "error", message: "no model configured" });

		await expect(resultPromise).rejects.toThrow("no model configured");
	});

	it("rejects when the underlying session creation itself fails", async () => {
		const client = fakeClient();
		(client.createSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("daemon unreachable"));
		const complete = createPiWorkspaceTitleComplete(client);

		await expect(complete("Name this conversation...")).rejects.toThrow("daemon unreachable");
	});
});
