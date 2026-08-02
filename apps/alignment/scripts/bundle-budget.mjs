// Pure budget-evaluation logic for check-bundle-budget.mjs, split out so it
// can be unit tested against fabricated sizes instead of only a real build.
//
// Two tiers per asset type, not one: "entry" is the initial page load's own
// weight (the `alignment-*` chunk Vite builds from index.html's declared
// entry) -- this is what every session pays before anything is interactive,
// so it stays close to its measured baseline. "total" bounds everything
// shipped, including chunks split out via dynamic import() (e.g.
// WindowDockview's dockview-react dependency) -- looser, since those bytes
// are real but deferred off the critical path, not absent.
export const BUDGETS_BYTES = {
	entryJs: 155_000, // gzip -- measured ~124.2kB baseline; raised from 150kB for @radix-ui/react-popover (Notifications), still ~14% headroom
	entryCss: 7_000, // gzip -- measured ~5.6kB baseline, ~21% headroom
	totalJs: 250_000, // gzip -- measured ~207.2kB baseline (entry + WindowDockview's dockview-react chunk); raised alongside entryJs, ~13% headroom
	totalCss: 18_000, // gzip -- measured ~14.3kB baseline, ~23% headroom
};

export function humanKb(bytes) {
	return `${(bytes / 1024).toFixed(1)} kB`;
}

/**
 * Compares each bucket's total gzip size against its budget.
 * `sizesByBucket` maps bucket name (e.g. "entryJs") -> { totalGzipBytes, fileCount }.
 * Returns { report: string[], violations: string[] }.
 */
export function evaluateBudgets(sizesByBucket, budgets = BUDGETS_BYTES) {
	const report = [];
	const violations = [];

	for (const [bucket, budget] of Object.entries(budgets)) {
		const { totalGzipBytes = 0, fileCount = 0 } = sizesByBucket[bucket] ?? {};
		report.push(`${bucket}: ${humanKb(totalGzipBytes)} gzip (budget ${humanKb(budget)}) across ${fileCount} file(s)`);
		if (totalGzipBytes > budget) violations.push(`${bucket} bundle is ${humanKb(totalGzipBytes)} gzip, over the ${humanKb(budget)} budget`);
	}

	return { report, violations };
}
