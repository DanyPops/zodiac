import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_NAME_SCAN_LINES, readSessionName } from "./conversations-api.js";

function sessionNameEvent(name: string): string {
	return JSON.stringify({ bus: "internal", type: "session.name", correlationId: "c1", timestamp: Date.now(), payload: { name } });
}

function noiseLine(): string {
	return JSON.stringify({ bus: "internal", type: "noop", correlationId: "c1", timestamp: Date.now(), payload: {} });
}

describe("readSessionName", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("finds a session.name event that arrives late in the file, not just near the top", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-session-"));
		const filePath = join(dir, "late-name.jsonl");
		const lines = [...Array(200).fill(0).map(() => noiseLine()), sessionNameEvent("Late auto-name")];
		writeFileSync(filePath, `${lines.join("\n")}\n`);

		await expect(readSessionName(filePath)).resolves.toBe("Late auto-name");
	});

	it("stops scanning at MAX_NAME_SCAN_LINES instead of reading a pathological file without bound", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-session-"));
		const filePath = join(dir, "past-bound.jsonl");
		const lines = [...Array(MAX_NAME_SCAN_LINES + 10).fill(0).map(() => noiseLine()), sessionNameEvent("Too late to matter")];
		writeFileSync(filePath, `${lines.join("\n")}\n`);

		await expect(readSessionName(filePath)).resolves.toBeUndefined();
	});

	it("resolves undefined for a file with no session.name event at all", async () => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-session-"));
		const filePath = join(dir, "no-name.jsonl");
		writeFileSync(filePath, `${noiseLine()}\n${noiseLine()}\n`);

		await expect(readSessionName(filePath)).resolves.toBeUndefined();
	});

	it("resolves undefined for a missing file instead of rejecting", async () => {
		await expect(readSessionName("/nonexistent/session-does-not-exist.jsonl")).resolves.toBeUndefined();
	});
});
