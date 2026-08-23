import { describe, expect, it } from "vitest";
import { createOriginPolicy } from "./origin-policy.js";

describe("createOriginPolicy", () => {
	it("allows a request that sent no Origin header at all -- every real non-browser client", () => {
		const policy = createOriginPolicy(["http://127.0.0.1:5173"]);
		expect(policy.isAllowed(undefined)).toBe(true);
	});

	it("allows an Origin that exactly matches the allowlist", () => {
		const policy = createOriginPolicy(["http://127.0.0.1:5173"]);
		expect(policy.isAllowed("http://127.0.0.1:5173")).toBe(true);
	});

	it("denies an Origin absent from the allowlist -- default-deny, not reflected", () => {
		const policy = createOriginPolicy(["http://127.0.0.1:5173"]);
		expect(policy.isAllowed("https://evil.example")).toBe(false);
	});

	it("denies every Origin when the allowlist is empty", () => {
		const policy = createOriginPolicy([]);
		expect(policy.isAllowed("http://127.0.0.1:5173")).toBe(false);
	});

	it("does not match by scheme/host/port substring or prefix -- exact string only", () => {
		const policy = createOriginPolicy(["http://127.0.0.1:5173"]);
		expect(policy.isAllowed("http://127.0.0.1:51730")).toBe(false);
		expect(policy.isAllowed("http://evil.example#http://127.0.0.1:5173")).toBe(false);
	});
});
