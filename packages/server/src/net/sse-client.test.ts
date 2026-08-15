import { describe, expect, it } from "vitest";
import { readSseFrames } from "./sse-client.js";

/** Builds a real Response backed by a real ReadableStream, chunked exactly as given -- proving the reader survives a frame split across chunk boundaries, not just one convenient whole-buffer read. */
function responseFromChunks(chunks: readonly string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(stream);
}

describe("readSseFrames", () => {
	it("parses one data: frame per blank-line-terminated event", async () => {
		const response = responseFromChunks([`data: {"a":1}\n\n`, `data: {"a":2}\n\n`]);
		const frames: string[] = [];
		await readSseFrames(response, (data) => frames.push(data));
		expect(frames).toEqual([`{"a":1}`, `{"a":2}`]);
	});

	it("reassembles a frame split across several chunk boundaries", async () => {
		const response = responseFromChunks([`data: {"hel`, `lo":"wor`, `ld"}\n`, `\n`]);
		const frames: string[] = [];
		await readSseFrames(response, (data) => frames.push(data));
		expect(frames).toEqual([`{"hello":"world"}`]);
	});

	it("joins a multi-line data field with newlines, per the SSE spec", async () => {
		const response = responseFromChunks([`data: line one\ndata: line two\n\n`]);
		const frames: string[] = [];
		await readSseFrames(response, (data) => frames.push(data));
		expect(frames).toEqual(["line one\nline two"]);
	});

	it("ignores a trailing partial frame the stream ends without ever completing", async () => {
		const response = responseFromChunks([`data: {"a":1}\n\n`, `data: {"incomplete"`]);
		const frames: string[] = [];
		await readSseFrames(response, (data) => frames.push(data));
		expect(frames).toEqual([`{"a":1}`]);
	});

	it("resolves once the stream ends", async () => {
		const response = responseFromChunks([`data: {}\n\n`]);
		await expect(readSseFrames(response, () => {})).resolves.toBeUndefined();
	});

	it("rejects when the response has no readable body", async () => {
		const response = new Response(null);
		await expect(readSseFrames(response, () => {})).rejects.toThrow(/no readable body/);
	});
});
