import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWithSchema } from "./result.js";

const SCHEMA = z.object({ id: z.string().min(1), count: z.number().int() });

describe("parseWithSchema", () => {
	it("returns ok:true with the parsed value on success", () => {
		const result = parseWithSchema(SCHEMA, { id: "a", count: 1 });
		expect(result).toEqual({ ok: true, value: { id: "a", count: 1 } });
	});

	it("returns ok:false with human-readable issues on failure, never throwing", () => {
		const result = parseWithSchema(SCHEMA, { id: "", count: "not-a-number" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.issues.some((issue) => issue.startsWith("id:"))).toBe(true);
		}
	});

	it("bounds the number of reported issues even for a badly-shaped payload", () => {
		const wideSchema = z.object(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`field${i}`, z.string()])));
		const result = parseWithSchema(wideSchema, {});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues.length).toBeLessThanOrEqual(20);
	});
});
