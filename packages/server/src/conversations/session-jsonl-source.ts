import { createReadStream, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { createInterface } from "node:readline";
import type { Disposable, NormalizedEvent, Source } from "./types.js";

export interface SessionJsonlSourceOptions {
	/** Absolute path to a session JSONL file, e.g. from ~/.local/share/alef/sessions/<cwd-hash>/<id>.jsonl. */
	filePath: string;
	/** Logical session id to attach to every event produced from this file. */
	sessionId: string;
	/** Tail the file for appended lines after the historical read completes. Default: false. */
	tail?: boolean;
}

interface RawRecord {
	bus: string;
	type: string;
	correlationId: string;
	payload: unknown;
	timestamp: number;
	elapsed?: number;
	hash?: string;
}

/**
 * Validates and narrows a parsed JSON value into a RawRecord. Returns
 * undefined for anything that doesn't match Alef's session record shape —
 * malformed or unexpected lines are skipped, never thrown, since a session
 * file being tailed live can be observed mid-write.
 */
function toRawRecord(value: unknown): RawRecord | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const obj = value as Record<string, unknown>;
	if (typeof obj.bus !== "string") return undefined;
	if (typeof obj.type !== "string") return undefined;
	if (typeof obj.correlationId !== "string") return undefined;
	if (typeof obj.timestamp !== "number") return undefined;
	return {
		bus: obj.bus,
		type: obj.type,
		correlationId: obj.correlationId,
		payload: obj.payload,
		timestamp: obj.timestamp,
		elapsed: typeof obj.elapsed === "number" ? obj.elapsed : undefined,
		hash: typeof obj.hash === "string" ? obj.hash : undefined,
	};
}

function parseLine(line: string): RawRecord | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return undefined;
	}
	return toRawRecord(parsed);
}

function extractToolCallId(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null) return undefined;
	const v = (payload as Record<string, unknown>).toolCallId;
	return typeof v === "string" ? v : undefined;
}

function toNormalizedEvent(sourceId: string, sessionId: string, raw: RawRecord): NormalizedEvent {
	return {
		sourceId,
		sessionId,
		bus: raw.bus,
		type: raw.type,
		correlationId: raw.correlationId,
		payload: raw.payload,
		timestamp: raw.timestamp,
		elapsed: raw.elapsed,
		hash: raw.hash,
		toolCallId: extractToolCallId(raw.payload),
	};
}

export interface ReadSessionEventsOptions {
	filePath: string;
	sessionId: string;
	maxEvents: number;
}

/** Returns a bounded historical snapshot and resolves when reading is complete. */
export async function readSessionEvents(options: ReadSessionEventsOptions): Promise<NormalizedEvent[]> {
	const { filePath, sessionId, maxEvents } = options;
	if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error("maxEvents must be a positive integer");
	if (!existsSync(filePath)) return [];

	const sourceId = `session-jsonl:${sessionId}`;
	const events: NormalizedEvent[] = [];
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			const raw = parseLine(line);
			if (raw) events.push(toNormalizedEvent(sourceId, sessionId, raw));
			if (events.length >= maxEvents) break;
		}
	} finally {
		lines.close();
		stream.destroy();
	}
	return events;
}

/**
 * Reads a session JSONL file into NormalizedEvents, optionally tailing it for
 * live appends afterward. This is Alef's own session trace format — the same
 * mechanism serves both a finished historical session and a live one, with
 * no daemon, network, or auth involved (see docs/decision on wiring choice).
 */
export function createSessionJsonlSource(options: SessionJsonlSourceOptions): Source {
	const { filePath, sessionId, tail = false } = options;
	const sourceId = `session-jsonl:${sessionId}`;

	return {
		ingest(sink: (event: NormalizedEvent) => void): Disposable {
			let disposed = false;
			let watcher: FSWatcher | undefined;
			let byteOffset = 0;
			let tailBuffer = "";

			function emitLine(line: string): void {
				const raw = parseLine(line);
				if (!raw) return;
				sink(toNormalizedEvent(sourceId, sessionId, raw));
			}

			async function readHistorical(): Promise<void> {
				if (!existsSync(filePath)) {
					byteOffset = 0;
					return;
				}
				const stream = createReadStream(filePath, { encoding: "utf8" });
				const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
				for await (const line of rl) {
					if (disposed) break;
					emitLine(line);
				}
				byteOffset = statSync(filePath).size;
			}

			function readAppended(): void {
				const size = statSync(filePath).size;
				if (size <= byteOffset) return;
				const chunkStream = createReadStream(filePath, { encoding: "utf8", start: byteOffset, end: size - 1 });
				let chunkData = "";
				chunkStream.on("data", (chunk) => {
					// Node's stream types don't narrow `chunk` to `string` just because
					// `encoding: "utf8"` was passed to createReadStream -- .toString() is
					// correct either way (Buffer or already-string) and keeps this exact
					// regardless of what the type checker can prove here.
					chunkData += chunk.toString();
				});
				chunkStream.on("end", () => {
					byteOffset = size;
					tailBuffer += chunkData;
					const lines = tailBuffer.split("\n");
					tailBuffer = lines.pop() ?? "";
					for (const line of lines) emitLine(line);
				});
			}

			function startTail(): void {
				watcher = watch(filePath, { persistent: true }, (eventType) => {
					if (disposed || eventType !== "change") return;
					readAppended();
				});
			}

			void readHistorical().then(() => {
				if (!disposed && tail) startTail();
			});

			return {
				dispose(): void {
					disposed = true;
					watcher?.close();
					watcher = undefined;
				},
			};
		},
	};
}
