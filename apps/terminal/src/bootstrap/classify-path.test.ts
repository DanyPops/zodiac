import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyPath } from "./classify-path.js";

let root: string | undefined;

afterEach(() => {
	if (root) {
		try {
			execFileSync("chmod", ["-R", "u+rwx", root]);
		} catch {
			/* already restored */
		}
		rmSync(root, { recursive: true, force: true });
	}
	root = undefined;
});

describe("classifyPath", () => {
	it("classifies a missing CLI argument as 'none' without touching the filesystem", () => {
		expect(classifyPath(undefined)).toEqual({ kind: "none" });
	});

	it("resolves a relative argument against the given cwd, not process.cwd()", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-classify-"));
		mkdirSync(join(root, "project"));
		expect(classifyPath("project", root)).toEqual({ kind: "directory", path: join(root, "project") });
	});

	it("classifies a real directory", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-classify-"));
		expect(classifyPath(root)).toEqual({ kind: "directory", path: root });
	});

	it("classifies a real file", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-classify-"));
		const file = join(root, "a.ts");
		writeFileSync(file, "export const a = 1;\n");
		expect(classifyPath(file)).toEqual({ kind: "file", path: file });
	});

	it("classifies a path that does not exist as 'missing', not an error", () => {
		root = mkdtempSync(join(tmpdir(), "alignment-classify-"));
		const missing = join(root, "does-not-exist");
		expect(classifyPath(missing)).toEqual({ kind: "missing", path: missing });
	});

	it("classifies a path denied by a parent directory's permissions as 'denied'", () => {
		if (process.getuid?.() === 0) return; // root bypasses filesystem permission checks entirely
		root = mkdtempSync(join(tmpdir(), "alignment-classify-"));
		const blocked = join(root, "blocked");
		mkdirSync(blocked);
		const target = join(blocked, "a.ts");
		writeFileSync(target, "export const a = 1;\n");
		chmodSync(blocked, 0o000);
		expect(classifyPath(target)).toEqual({ kind: "denied", path: target });
	});
});
