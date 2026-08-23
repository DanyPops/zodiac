import { describe, expect, it } from "vitest";
import { DesktopIpcRequestSchema, DesktopIpcResultSchema, DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL, HOST_CAPABILITY_INVENTORY } from "./host-port.js";

describe("HOST_CAPABILITY_INVENTORY", () => {
	it("classifies every listed capability with a non-empty rationale", () => {
		expect(HOST_CAPABILITY_INVENTORY.length).toBeGreaterThan(0);
		for (const entry of HOST_CAPABILITY_INVENTORY) {
			expect(entry.capability.length).toBeGreaterThan(0);
			expect(entry.rationale.length).toBeGreaterThan(0);
			expect(["web-standard", "host-port", "zodiacd-api", "rejected"]).toContain(entry.classification);
		}
	});

	it("lists no capability twice", () => {
		const names = HOST_CAPABILITY_INVENTORY.map((entry) => entry.capability);
		expect(new Set(names).size).toBe(names.length);
	});

	it("has at least one real host-port capability, justifying DesktopHostPort's existence", () => {
		expect(HOST_CAPABILITY_INVENTORY.some((entry) => entry.classification === "host-port")).toBe(true);
	});
});

describe("DesktopIpcRequestSchema", () => {
	it("accepts a well-formed resolveZodiacdBaseUrl request", () => {
		const result = DesktopIpcRequestSchema.safeParse({ channel: DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL, requestId: "req-1" });
		expect(result.success).toBe(true);
	});

	it("rejects an unknown channel name, closing off an arbitrary raw-ipcRenderer-shaped payload", () => {
		const result = DesktopIpcRequestSchema.safeParse({ channel: "some.other.channel", requestId: "req-1" });
		expect(result.success).toBe(false);
	});

	it("rejects an empty requestId", () => {
		const result = DesktopIpcRequestSchema.safeParse({ channel: DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL, requestId: "" });
		expect(result.success).toBe(false);
	});
});

describe("DesktopIpcResultSchema", () => {
	it("accepts a successful result carrying only a base URL, never a credential field", () => {
		const result = DesktopIpcResultSchema.safeParse({ ok: true, requestId: "req-1", baseUrl: "http://127.0.0.1:4173" });
		expect(result.success).toBe(true);
	});

	it("rejects a success result with a non-URL baseUrl", () => {
		const result = DesktopIpcResultSchema.safeParse({ ok: true, requestId: "req-1", baseUrl: "not-a-url" });
		expect(result.success).toBe(false);
	});

	it("accepts a typed failure result with a bounded reason and message", () => {
		const result = DesktopIpcResultSchema.safeParse({ ok: false, requestId: "req-1", reason: "daemon-unreachable", message: "zodiacd is not running" });
		expect(result.success).toBe(true);
	});

	it("rejects a failure result with an unrecognized reason", () => {
		const result = DesktopIpcResultSchema.safeParse({ ok: false, requestId: "req-1", reason: "something-else", message: "x" });
		expect(result.success).toBe(false);
	});
});
