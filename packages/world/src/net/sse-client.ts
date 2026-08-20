/**
 * Reads a `text/event-stream` HTTP response body (from a real `fetch()`
 * call) as a sequence of `data:` frames -- the one wire format zodiacd's
 * World SSE route actually produces: `data: <json>\n\n`, nothing fancier
 * (no multi-field events, no `id:`/`retry:` lines). Deliberately
 * hand-rolled rather than a dependency -- `Response.body` is a standard
 * `ReadableStream<Uint8Array>` in both a browser and modern Node (18+), so
 * this one implementation works unmodified in every real consumer.
 *
 * Intentionally duplicated (not shared via a fourth package) with
 * `@zodiac/notifications`'s own identical copy -- ~30 lines, zero external
 * dependencies, stateless, near-zero change rate. `@zodiac/world` and
 * `@zodiac/notifications` must both genuinely have zero dependency on
 * `@zodiac/server` (a browser bundle transitively depends on both), so
 * neither can import this from there; a whole shared package for this much
 * code would cost more (its own package.json, exports map, version to
 * bump) than the duplication it would remove. See the "Extract
 * @zodiac/world and @zodiac/notifications" Papyrus Task's own superseded
 * `@zodiac/sse-client` correction for the full reasoning.
 *
 * `onFrame` is called once per blank-line-terminated event with its raw
 * (not yet JSON-parsed) data payload -- parsing is the caller's own concern,
 * since a caller may need to special-case an unparseable frame differently
 * (skip vs. surface an error). Resolves once the stream ends (the server
 * closed the connection); rejects if the underlying read itself fails
 * (including a deliberate `AbortSignal` used on the original `fetch()`
 * call -- there is no separate cancellation parameter here, matching how
 * `fetch()` itself is cancelled).
 */
export async function readSseFrames(response: Response, onFrame: (data: string) => void): Promise<void> {
	const body = response.body;
	if (!body) throw new Error("readSseFrames: response has no readable body");
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let boundary = buffer.indexOf("\n\n");
		while (boundary !== -1) {
			const rawEvent = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const dataLines = rawEvent
				.split("\n")
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice("data:".length).trimStart());
			if (dataLines.length > 0) onFrame(dataLines.join("\n"));
			boundary = buffer.indexOf("\n\n");
		}
	}
}
