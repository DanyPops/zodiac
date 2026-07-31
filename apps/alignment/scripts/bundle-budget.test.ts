import { describe, expect, it } from "vitest";
import { evaluateBudgets } from "./bundle-budget.mjs";

describe("evaluateBudgets", () => {
	it("passes when every bucket is within its budget", () => {
		const { violations } = evaluateBudgets(
			{ entryJs: { totalGzipBytes: 100_000, fileCount: 1 }, entryCss: { totalGzipBytes: 5_000, fileCount: 1 } },
			{ entryJs: 150_000, entryCss: 7_000 },
		);
		expect(violations).toEqual([]);
	});

	it("reports a violation naming the bucket and both sizes when a budget is exceeded", () => {
		const { violations } = evaluateBudgets({ totalJs: { totalGzipBytes: 250_000, fileCount: 2 } }, { totalJs: 245_000 });
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatch(/totalJs bundle is 244\.1 kB gzip, over the 239\.3 kB budget/);
	});

	it("treats a missing bucket as zero bytes rather than throwing", () => {
		const { violations, report } = evaluateBudgets({}, { entryJs: 150_000 });
		expect(violations).toEqual([]);
		expect(report[0]).toMatch(/0 file\(s\)/);
	});
});
