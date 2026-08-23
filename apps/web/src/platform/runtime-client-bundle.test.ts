import { describe, expect, it } from "vitest";
import { createRuntimeClientBundle } from "./runtime-client-bundle.js";

describe("createRuntimeClientBundle", () => {
	it("carries the given base URL through unchanged", () => {
		const bundle = createRuntimeClientBundle("http://127.0.0.1:4390");
		expect(bundle.zodiacdBaseUrl).toBe("http://127.0.0.1:4390");
	});

	it("builds one client of each kind, all pointed at the same base URL", () => {
		const bundle = createRuntimeClientBundle("http://127.0.0.1:4390");
		expect(bundle.conversationClient).toBeDefined();
		expect(bundle.piClient).toBeDefined();
		expect(bundle.terminalClient).toBeDefined();
	});

	it("builds an independent bundle per call -- no shared module-level client state across two bundles", () => {
		const first = createRuntimeClientBundle("http://127.0.0.1:4390");
		const second = createRuntimeClientBundle("http://127.0.0.1:5000");
		expect(first.conversationClient).not.toBe(second.conversationClient);
		expect(first.piClient).not.toBe(second.piClient);
		expect(first.terminalClient).not.toBe(second.terminalClient);
		expect(first.zodiacdBaseUrl).not.toBe(second.zodiacdBaseUrl);
	});
});
