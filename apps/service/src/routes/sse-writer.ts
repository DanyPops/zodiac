import type { ServerResponse } from "node:http";

/**
 * Bounds the exact dimension `anomalyco/opencode` issue #16697's own forensics traced its real
 * 187GB RSS incident to: an unbounded amount of buffered-but-unsent SSE data accumulating in
 * memory once a connected client falls behind (or never reads at all). `res.writableLength` is
 * Node's own real, built-in accounting of exactly how many bytes are currently queued in this
 * response's internal write buffer, not yet flushed to the underlying socket -- not a bespoke
 * queue reimplementing what Node already tracks.
 *
 * 2MB, not a rounder-looking 4MB -- recalibrated from a real measurement, not a guessed constant
 * (see sse-payload-audit.test.ts). A first pass at 4MB turned out to sit ABOVE a genuinely
 * plausible full agent-session history replay (5,000 realistic events, MAX_HISTORY_EVENTS'
 * own bound -- see agent-routes.ts's own streamEvents) once actually measured (~3.37MB), which
 * would have made the cap a no-op for the exact backlog scenario this Task's own body worried
 * about. 2MB stays comfortably above every real single-frame worst case this codebase's own
 * data shapes were measured at (an order of magnitude of headroom in every case -- a large
 * WorldViewModel, a single large tool-call-end output, a generous pending-approvals list), while
 * genuinely catching that realistic history-replay backlog and anything larger.
 */
export const DEFAULT_MAX_SSE_BUFFERED_BYTES = 2 * 1024 * 1024;

/**
 * Writes one SSE frame. Returns false (having already destroyed the connection) once that
 * connection's own accumulated write buffer exceeds maxBufferedBytes -- a real, per-connection
 * failure ("client too slow, reconnect"), never a daemon-wide one; every other connected
 * client's own writableLength is completely untouched by this. A caller MUST stop writing to
 * this response once this returns false (break out of a replay loop, unsubscribe an onChange/
 * onEvent listener) -- the socket is already gone, and a write past that point would throw.
 */
export function writeSseFrame(res: ServerResponse, payload: unknown, maxBufferedBytes: number = DEFAULT_MAX_SSE_BUFFERED_BYTES): boolean {
	if (res.writableEnded || res.destroyed) return false;
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
	if (res.writableLength > maxBufferedBytes) {
		res.destroy();
		return false;
	}
	return true;
}
