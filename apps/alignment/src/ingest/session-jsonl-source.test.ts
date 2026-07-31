import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionJsonlSource, readSessionEvents } from "./session-jsonl-source.js";
import type { NormalizedEvent } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../test/fixtures/session-sample.jsonl");

function collectFor(events: NormalizedEvent[], ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("readSessionEvents", () => {
	it("returns a bounded historical snapshot without timing guesses", async () => {
		const events = await readSessionEvents({ filePath: FIXTURE, sessionId: "test-session", maxEvents: 3 });
		expect(events).toHaveLength(3);
		expect(events.map((event) => event.timestamp)).toEqual([1000, 1010, 1020]);
	});
});

describe("createSessionJsonlSource — historical read", () => {
	it("parses every well-formed line into a NormalizedEvent, in file order, skipping malformed lines", async () => {
		const events: NormalizedEvent[] = [];
		const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
		const handle = source.ingest((event) => events.push(event));
		await collectFor(events, 200);
		handle.dispose();

		// fixture has 10 well-formed lines + 1 malformed line
		expect(events).toHaveLength(10);
		expect(events[0]?.bus).toBe("sense");
		expect(events[0]?.type).toBe("dialog.message");
		expect(events[0]?.sessionId).toBe("test-session");
		expect(events[0]?.sourceId).toBe("session-jsonl:test-session");

		const types = events.map((e) => `${e.bus}/${e.type}`);
		expect(types[0]).toBe("sense/dialog.message");
		expect(types.at(-1)).toBe("motor/dialog.message");
	});

	it("extracts toolCallId from payload when present, for tool-call-level correlation distinct from the turn-level correlationId", async () => {
		const events: NormalizedEvent[] = [];
		const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
		const handle = source.ingest((event) => events.push(event));
		await collectFor(events, 200);
		handle.dispose();

		const fsEvents = events.filter((e) => e.type === "fs.read");
		expect(fsEvents).toHaveLength(2);
		expect(fsEvents[0]?.toolCallId).toBe("tc-1");
		expect(fsEvents[1]?.toolCallId).toBe("tc-1");
		// both share the turn-level correlationId too, but that's a coarser grouping
		expect(fsEvents[0]?.correlationId).toBe(fsEvents[1]?.correlationId);

		const dialogEvents = events.filter((e) => e.type === "dialog.message");
		expect(dialogEvents.every((e) => e.toolCallId === undefined)).toBe(true);
	});

	it("groups events into distinct correlationId chains matching the two turns in the fixture", async () => {
		const events: NormalizedEvent[] = [];
		const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
		const handle = source.ingest((event) => events.push(event));
		await collectFor(events, 200);
		handle.dispose();

		const correlationIds = new Set(events.map((e) => e.correlationId));
		expect(correlationIds.size).toBe(2);
	});

	it("carries optional elapsed and hash fields through when present, and omits them when absent", async () => {
		const events: NormalizedEvent[] = [];
		const source = createSessionJsonlSource({ filePath: FIXTURE, sessionId: "test-session" });
		const handle = source.ingest((event) => events.push(event));
		await collectFor(events, 200);
		handle.dispose();

		const senseFsRead = events.find((e) => e.bus === "sense" && e.type === "fs.read");
		expect(senseFsRead?.elapsed).toBe(10);
		expect(senseFsRead?.hash).toBe("deadbeef");

		const firstEvent = events[0];
		expect(firstEvent?.elapsed).toBeUndefined();
		expect(firstEvent?.hash).toBeUndefined();
	});
});

describe("createSessionJsonlSource — tailing a live file", () => {
	let dir: string;
	let filePath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "alignment-tail-"));
		filePath = join(dir, "live-session.jsonl");
		writeFileSync(
			filePath,
			`${JSON.stringify({ bus: "sense", type: "dialog.message", correlationId: "c-1", payload: { text: "hi" }, timestamp: 1 })}\n`,
		);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("emits historical lines first, then emits newly appended lines as they are written", async () => {
		const events: NormalizedEvent[] = [];
		const source = createSessionJsonlSource({ filePath, sessionId: "live-session", tail: true });
		const handle = source.ingest((event) => events.push(event));

		await collectFor(events, 150);
		expect(events).toHaveLength(1);

		appendFileSync(
			filePath,
			`${JSON.stringify({ bus: "motor", type: "dialog.message", correlationId: "c-1", payload: { text: "hi back" }, timestamp: 2 })}\n`,
		);

		await collectFor(events, 700);
		handle.dispose();

		expect(events).toHaveLength(2);
		expect(events[1]?.type).toBe("dialog.message");
		expect(events[1]?.bus).toBe("motor");
	});
});
