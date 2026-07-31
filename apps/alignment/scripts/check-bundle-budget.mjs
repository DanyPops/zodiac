#!/usr/bin/env node
// Fails the build pipeline if the production bundle grows past an explicit
// budget instead of only ever being noticed by someone eyeballing `vite
// build`'s own printed sizes. Run after `npm run build` (dist/ must exist).
//
// Budgets are gzip sizes, since that's what a real client transfers. They're
// set with headroom above the first slice's actual measured size, not
// shrink-wrapped to today's number -- the point is to catch real growth, not
// to force a re-justification on every dependency bump.

import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGETS_BYTES, evaluateBudgets } from "./bundle-budget.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distAssets = join(appRoot, "dist", "assets");

let assets;
try {
	assets = readdirSync(distAssets);
} catch {
	console.error(`No production build found at ${distAssets} -- run "npm run build" first.`);
	process.exit(1);
}

const sizesByExtension = {};
for (const extension of Object.keys(BUDGETS_BYTES)) {
	const matches = assets.filter((name) => name.endsWith(`.${extension}`));
	const totalGzipBytes = matches.reduce((sum, name) => sum + gzipSync(readFileSync(join(distAssets, name))).length, 0);
	sizesByExtension[extension] = { totalGzipBytes, fileCount: matches.length };
}

const { report, violations } = evaluateBudgets(sizesByExtension);
console.log(report.join("\n"));

if (violations.length > 0) {
	console.error(`\nBundle budget check failed:\n${violations.map((v) => `  ${v}`).join("\n")}`);
	console.error("\nEither trim what changed, or -- if the growth is deliberate and justified -- raise BUDGETS_BYTES in bundle-budget.mjs alongside that explanation.");
	process.exit(1);
}

console.log("\nBundle budget check passed.");
