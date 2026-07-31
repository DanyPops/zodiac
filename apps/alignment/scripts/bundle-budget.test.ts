import { describe, expect, it } from "vitest";
import { evaluateBudgets } from "./bundle-budget.mjs";

describe("evaluateBudgets", () => {
	it("passes when every extension is within its budget", () => {
		const { violations } = evaluateBudgets({ js: { totalGzipBytes: 100_000, fileCount: 1 }, css: { totalGzipBytes: 5_000, fileCount: 1 } }, { js: 200_000, css: 20_000 });
		expect(violations).toEqual([]);
	});

	it("reports a violation naming the extension and both sizes when a budget is exceeded", () => {
		const { violations } = evaluateBudgets({ js: { totalGzipBytes: 250_000, fileCount: 1 } }, { js: 200_000 });
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatch(/JS bundle is 244\.1 kB gzip, over the 195\.3 kB budget/);
	});

	it("treats a missing extension as zero bytes rather than throwing", () => {
		const { violations, report } = evaluateBudgets({}, { js: 200_000 });
		expect(violations).toEqual([]);
		expect(report[0]).toMatch(/0 file\(s\)/);
	});
});
