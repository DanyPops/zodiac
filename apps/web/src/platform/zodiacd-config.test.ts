import { describe, expect, it } from "vitest";
import { DEFAULT_ZODIACD_BASE_URL, resolveZodiacdBaseUrl } from "./zodiacd-config.js";

describe("resolveZodiacdBaseUrl", () => {
	it("defaults to http://127.0.0.1:4390 (zodiacd's own default port) when no override is set", () => {
		expect(resolveZodiacdBaseUrl({})).toBe(DEFAULT_ZODIACD_BASE_URL);
	});

	it("honors VITE_ZODIACD_URL when set", () => {
		expect(resolveZodiacdBaseUrl({ VITE_ZODIACD_URL: "http://example.com:9999" })).toBe("http://example.com:9999");
	});
});
