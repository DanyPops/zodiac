import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MAX_SSE_BUFFERED_BYTES, writeSseFrame } from "./sse-writer.js";

/** A minimal stub shaped exactly like the real ServerResponse surface writeSseFrame reads --
 * deterministic and instant, unlike a real socket where genuinely filling the OS-level TCP
 * window to observe backpressure is slow and non-deterministic. The real-socket proof (a
 * genuinely slow/non-reading client against a real daemon) lives in world-routes.test.ts/
 * agent-routes.test.ts/notification-routes.test.ts, using an injected tiny cap for speed. */
function stubResponse(writableLength: number) {
	return {
		writableEnded: false,
		destroyed: false,
		writableLength,
		write: vi.fn(),
		destroy: vi.fn(),
	};
}

describe("writeSseFrame", () => {
	it("writes the frame and reports success when the connection's own buffered bytes stay under the cap", () => {
		const res = stubResponse(100);
		const ok = writeSseFrame(res as never, { hello: "world" }, 1_000);
		expect(ok).toBe(true);
		expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ hello: "world" })}\n\n`);
		expect(res.destroy).not.toHaveBeenCalled();
	});

	it("destroys the connection and reports failure once writableLength exceeds the cap -- the real 187GB-RSS-incident dimension, bounded", () => {
		const res = stubResponse(2_000);
		const ok = writeSseFrame(res as never, { big: "payload" }, 1_000);
		expect(ok).toBe(false);
		expect(res.destroy).toHaveBeenCalledOnce();
	});

	it("still writes the frame before destroying -- a client that's merely crossed the line on this exact frame still receives it", () => {
		const res = stubResponse(2_000);
		writeSseFrame(res as never, { big: "payload" }, 1_000);
		expect(res.write).toHaveBeenCalledOnce();
	});

	it("is a real no-op (never writes, never destroys again) once the connection has already ended", () => {
		const res = { ...stubResponse(0), writableEnded: true };
		const ok = writeSseFrame(res as never, { hello: "world" }, 1_000);
		expect(ok).toBe(false);
		expect(res.write).not.toHaveBeenCalled();
		expect(res.destroy).not.toHaveBeenCalled();
	});

	it("is a real no-op once the connection is already destroyed", () => {
		const res = { ...stubResponse(0), destroyed: true };
		const ok = writeSseFrame(res as never, { hello: "world" }, 1_000);
		expect(ok).toBe(false);
		expect(res.write).not.toHaveBeenCalled();
	});

	it("defaults to DEFAULT_MAX_SSE_BUFFERED_BYTES (2MB) when no cap is given, not an unbounded one", () => {
		const underCap = stubResponse(DEFAULT_MAX_SSE_BUFFERED_BYTES - 1);
		expect(writeSseFrame(underCap as never, {})).toBe(true);

		const overCap = stubResponse(DEFAULT_MAX_SSE_BUFFERED_BYTES + 1);
		expect(writeSseFrame(overCap as never, {})).toBe(false);
	});
});
