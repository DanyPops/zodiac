import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveZodiacServiceStateDir } from "./state-dir.js";

describe("resolveZodiacServiceStateDir", () => {
	it("defaults to ~/.zodiac/service when no override is set", () => {
		const dir = resolveZodiacServiceStateDir({});
		expect(dir.endsWith(join(".zodiac", "service"))).toBe(true);
	});

	it("honors ZODIAC_SERVICE_STATE_DIR when set", () => {
		const dir = resolveZodiacServiceStateDir({ ZODIAC_SERVICE_STATE_DIR: "/tmp/custom-zodiac-service" });
		expect(dir).toBe("/tmp/custom-zodiac-service");
	});
});
