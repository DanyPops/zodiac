import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nearestGitRoot } from "./nearest-git-root.js";

let root: string | undefined;

afterEach(() => {
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("nearestGitRoot", () => {
	it("finds a real .git directory at the starting directory itself", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-git-root-"));
		mkdirSync(join(root, ".git"));
		expect(nearestGitRoot(root)).toBe(root);
	});

	it("walks up through real nested directories to find an ancestor .git", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-git-root-"));
		mkdirSync(join(root, ".git"));
		const nested = join(root, "src", "deep");
		mkdirSync(nested, { recursive: true });
		expect(nearestGitRoot(nested)).toBe(root);
	});

	it("returns undefined when no ancestor has a .git directory", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-git-root-"));
		expect(nearestGitRoot(root)).toBeUndefined();
	});

	it("never treats the bare filesystem root as a discovered root", () => {
		expect(nearestGitRoot("/", (path) => path === "/.git")).toBeUndefined();
	});
});
