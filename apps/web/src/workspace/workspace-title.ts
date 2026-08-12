import { extractMessageText, type PiRpcEvent } from "@danypops/pi-rpc-protocol";
import type { PiClient } from "../pi/client.js";

/**
 * LLM-bound default naming for an auto-created Workspace, mirroring the
 * design (not the code -- Zodiac's LLM plumbing is a different shape
 * entirely) of ~/Workspace/alef's own
 * packages/core/session/src/context/title.ts (createLlmTitleGenerator) and
 * metadata.ts (clampTitleWords/TITLE_WORD_MIN/TITLE_WORD_MAX): a tight
 * 2-5-word instruction, a synchronous heuristic fallback used both when no
 * LLM is configured and whenever the LLM call itself fails, so a broken or
 * slow naming call can never leave a Workspace nameless.
 *
 * Deliberate timing difference from alef: alef's own titleFromPrompt is
 * awaited as part of the turn that first processes a session's context,
 * blocking that turn on one extra LLM round trip. Here the caller (see the
 * empty-by-default + auto-create child task) creates the Workspace
 * immediately with `provisionalTitleFromText`'s heuristic result, sends the
 * prompt, and only then fires `createLlmWorkspaceTitleGenerator`'s result in
 * the background, renaming the Workspace once it resolves -- sending the
 * first prompt must never feel delayed by a naming call.
 */

export const TITLE_WORD_MIN = 2;
export const TITLE_WORD_MAX = 5;

/** Normalizes a candidate title to 2-5 words, stripping quotes/trailing punctuation -- same rules as alef's own clampTitleWords. Returns undefined for anything too short to be a real title (a bare slash/colon command, a single word). */
/** Every character clampTitleWords strips from the end of a candidate title -- a plain Set + linear backward scan (see stripTrailingPunctuation) rather than a `/[.!?;:,]+$/`-shaped regex: that pattern's own trailing `+` before an anchor is exactly the shape sonarjs's super-linear-regex check flags, since a regex engine that doesn't special-case the anchor can retry the match at every string position, O(n) attempts each up to O(n) long, for a genuinely quadratic worst case on a long adversarial string of matching characters. */
const TRAILING_PUNCTUATION = new Set([".", "!", "?", ";", ":", ","]);

/** Strips every trailing character in TRAILING_PUNCTUATION, working backward from the end -- same result as `/[.!?;:,]+$/` (all of them, not just one), but a plain linear scan with no regex backtracking to reason about. */
function stripTrailingPunctuation(text: string): string {
	let end = text.length;
	while (end > 0 && TRAILING_PUNCTUATION.has(text[end - 1]!)) end -= 1;
	return text.slice(0, end);
}

export function clampTitleWords(text: string): string | undefined {
	const cleaned = stripTrailingPunctuation(text.replace(/["'`]/g, ""))
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned || cleaned.startsWith(":") || cleaned.startsWith("/")) return undefined;
	const words = cleaned.split(" ").filter(Boolean);
	if (words.length < TITLE_WORD_MIN) return undefined;
	return words.slice(0, TITLE_WORD_MAX).join(" ");
}

/** A heuristic Workspace title straight from the user's own first message -- the instant fallback shown before (or in place of) any LLM-generated one. */
export function provisionalTitleFromText(text: string): string | undefined {
	return clampTitleWords(text);
}

const TITLE_PROMPT_TEMPLATE = `You name chat sessions. Reply with ONLY a title of ${TITLE_WORD_MIN} to ${TITLE_WORD_MAX} words. No quotes, no punctuation, no explanation, no trailing period.

Name this conversation from the user's first message.

<message>
{message}
</message>

Title (${TITLE_WORD_MIN}-${TITLE_WORD_MAX} words):`;

const MESSAGE_MAX_CHARS = 800;

/**
 * The injected LLM-access port -- deliberately just "a prompt in, the raw
 * reply text out," simpler than alef's own SummarizerComplete (which
 * returns a whole content-block message): the one production adapter below
 * already resolves an entire Pi turn down to its final assistant text, so
 * there's nothing richer for this port to carry.
 */
export type WorkspaceTitleComplete = (prompt: string) => Promise<string>;

/**
 * Builds an async Workspace title generator from a prompt (the user's first
 * message). Never rejects: falls back to `provisionalTitleFromText`'s
 * heuristic both when the injected `complete` throws and when its reply
 * doesn't clamp to a real title (e.g. a single-word or empty reply).
 */
export function createLlmWorkspaceTitleGenerator(complete: WorkspaceTitleComplete): (prompt: string) => Promise<string | undefined> {
	return async (prompt) => {
		const fallback = provisionalTitleFromText(prompt);
		const excerpt = prompt.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX_CHARS);
		if (!excerpt) return fallback;
		try {
			const raw = await complete(TITLE_PROMPT_TEMPLATE.replace("{message}", excerpt));
			const firstLine = raw.split("\n")[0]?.trim();
			return (firstLine ? clampTitleWords(firstLine) : undefined) ?? fallback;
		} catch {
			return fallback;
		}
	};
}

/**
 * The one production WorkspaceTitleComplete: spins up a short-lived Pi
 * session solely to answer the naming prompt, reusing the exact
 * message_end/extractMessageText event-handling convention
 * pi-chat-controller.ts already established (role !== "user" marks the
 * assistant's own reply), then unsubscribes and aborts the session so it
 * doesn't linger. No new server endpoint -- this is 100% existing,
 * already-tested PiClient plumbing (createSession/sendPrompt/streamEvents/
 * abort), used for one throwaway exchange instead of a real conversation.
 */
export function createPiWorkspaceTitleComplete(client: PiClient): WorkspaceTitleComplete {
	return (prompt) => client.createSession().then((sessionId) => runNamingSession(client, sessionId, prompt));
}

/**
 * Runs one throwaway Pi turn end-to-end and resolves with its final
 * assistant reply text -- pulled out of createPiWorkspaceTitleComplete
 * itself (which used to build this Promise inline, two closures deeper)
 * so its own cleanup/settle helpers and the streamEvents/sendPrompt
 * callbacks don't sit 5 functions deep in one closure (sonarjs's own
 * no-nested-functions cap is 4); the extraction is purely mechanical, no
 * behavior changed.
 */
function runNamingSession(client: PiClient, sessionId: string, prompt: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		// Deliberately `let`, initialized to undefined rather than folded into
		// `const unsubscribe = client.streamEvents(...)`: PiClient#streamEvents'
		// own type signature never promises its onEvent/onError callbacks are
		// always asynchronous, only every real implementation and test fake in
		// this codebase happens to be today (EventSource dispatch is inherently
		// async; every test fake here stores the listener and only invokes it
		// from a later, explicit emit()). If a future PiClient implementation
		// ever *did* call back synchronously during streamEvents() itself,
		// `unsubscribe?.()` on a still-undefined `let` is a harmless no-op --
		// `const` would instead throw a TDZ ReferenceError from inside that
		// synchronous callback, which createLlmWorkspaceTitleGenerator's own
		// "never rejects" contract can't afford. Not a case eslint's static
		// prefer-const check can see, so it's silenced here, not obeyed.
		// eslint-disable-next-line prefer-const
		let unsubscribe: (() => void) | undefined;
		let settled = false;

		function cleanup(): void {
			unsubscribe?.();
			void client.abort(sessionId).catch(() => {});
		}

		function settle(action: () => void): void {
			if (settled) return;
			settled = true;
			cleanup();
			action();
		}

		unsubscribe = client.streamEvents(
			sessionId,
			(event: PiRpcEvent) => {
				if (event.type === "message_end" && event.message.role !== "user") {
					settle(() => resolve(extractMessageText(event.message)));
				} else if (event.type === "response" && !event.success) {
					settle(() => reject(new Error(event.error ?? "Pi rejected the naming prompt.")));
				}
			},
			(error) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))),
		);

		client.sendPrompt(sessionId, prompt).catch((error: unknown) => {
			settle(() => reject(error instanceof Error ? error : new Error(String(error))));
		});
	});
}
