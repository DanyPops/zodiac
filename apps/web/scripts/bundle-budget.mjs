// Pure budget-evaluation logic for check-bundle-budget.mjs, split out so it
// can be unit tested against fabricated sizes instead of only a real build.
//
// Two tiers per asset type, not one: "entry" is the initial page load's own
// weight (the `zodiac-*` chunk Vite builds from index.html's declared
// entry) -- this is what every session pays before anything is interactive,
// so it stays close to its measured baseline. "total" bounds everything
// shipped, including chunks split out via dynamic import() (e.g.
// WindowDockview's dockview-react dependency) -- looser, since those bytes
// are real but deferred off the critical path, not absent.
export const BUDGETS_BYTES = {
	entryJs: 155_000, // gzip -- measured ~124.2kB baseline; raised from 150kB for @radix-ui/react-popover (Notifications), still ~14% headroom
	entryCss: 7_400, // gzip -- measured ~5.6kB baseline; raised from 7kB for the Dock Ruler's own overlay hiding rule, then from 7.2kB for Picker's new cmdk-driven aria-selected/aria-disabled variant classes (task 04bd1d82), ~5% headroom
	totalJs: 375_000, // gzip -- measured ~315.8kB baseline (entry + WindowDockview's dockview-react chunk + the new lazy-loaded TerminalSurface chunk, ~84.6kB gzip for xterm.js + @xterm/addon-fit); raised for the Terminal Surface Template, a real deliberate capability paid for only by a session that actually docks a Terminal (same reasoning as WindowDockview's own prior raise), ~14% headroom
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
