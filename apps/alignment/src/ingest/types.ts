/**
 * Alef's own session trace envelope, as observed on disk at
 * ~/.local/share/alef/sessions/<cwd-hash>/*.jsonl — produced by the kernel's
 * auto-trace bus middleware (packages/core/kernel/src/bus/auto-trace.ts) and
 * traceEvent sessionSink (packages/core/kernel/src/trace.ts). Not invented —
 * normalized from the real shape.
 */
export interface NormalizedEvent {
	/** Which Source produced this event, e.g. "session-jsonl:<sessionId>". */
	sourceId: string;
	/** Which session this event belongs to. */
	sessionId: string;
	/** Alef bus channel: "motor" | "sense" | "signal" | "debug" (observed values; not a closed enum — new buses may appear). */
	bus: string;
	/** Event type, e.g. "dialog.message", "llm.result", "fs.read". */
	type: string;
	/**
	 * Groups the whole request/response exchange this event belongs to
	 * (observed: shared across an entire turn's dialog.message -> llm.result
	 * -> tool calls -> dialog.message chain, NOT a single motor/sense pair).
	 */
	correlationId: string;
	/** Event-specific data; shape varies by (bus, type). */
	payload: unknown;
	/** Epoch milliseconds. */
	timestamp: number;
	/** Optional duration in milliseconds, when the record carries one. */
	elapsed?: number;
	/** Optional content hash, when the record carries one. */
	hash?: string;
	/**
	 * Extracted from payload.toolCallId when present. This is the finer-grained
	 * id that pairs one motor request with its matching sense response for a
	 * single tool call (distinct from correlationId, which spans the whole turn).
	 */
	toolCallId?: string;
}

export interface Disposable {
	dispose: () => void;
}

/**
 * A pluggable ingestion source. Sources know nothing about each other or
 * about how their events are consumed — they only produce NormalizedEvents.
 * Multiple sources (this file-based one, a live SSE source, etc.) can feed
 * the same downstream graph without the graph caring which produced what.
 */
export interface Source {
	/** Start ingestion; calls `sink` for each event as it becomes available. Returns a handle to stop ingestion. */
	ingest: (sink: (event: NormalizedEvent) => void) => Disposable;
}
