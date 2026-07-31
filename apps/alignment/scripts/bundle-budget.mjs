// Pure budget-evaluation logic for check-bundle-budget.mjs, split out so it
// can be unit tested against fabricated sizes instead of only a real build.

export const BUDGETS_BYTES = {
	js: 200_000, // gzip
	css: 20_000, // gzip
};

export function humanKb(bytes) {
	return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Compares each extension's total gzip size against its budget.
 * `sizesByExtension` maps extension -> { totalGzipBytes, fileCount }.
 * Returns { report: string[], violations: string[] }.
 */
export function evaluateBudgets(sizesByExtension, budgets = BUDGETS_BYTES) {
	const report = [];
	const violations = [];

	for (const [extension, budget] of Object.entries(budgets)) {
		const { totalGzipBytes = 0, fileCount = 0 } = sizesByExtension[extension] ?? {};
		report.push(`${extension.toUpperCase()}: ${humanKb(totalGzipBytes)} gzip (budget ${humanKb(budget)}) across ${fileCount} file(s)`);
		if (totalGzipBytes > budget) violations.push(`${extension.toUpperCase()} bundle is ${humanKb(totalGzipBytes)} gzip, over the ${humanKb(budget)} budget`);
	}

	return { report, violations };
}
