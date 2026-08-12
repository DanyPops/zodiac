import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/alignment-lector";
import { afterEach, describe, expect, it } from "vitest";
import { createLectorHost, type LectorHost } from "../lector/lector-host.js";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";
import { classifyPath } from "./classify-path.js";
import { bootstrapWorkspace } from "./workspace-bootstrap.js";

let root: string | undefined;
let stopDaemon: (() => Promise<void>) | undefined;
let host: LectorHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
	await stopDaemon?.();
	stopDaemon = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

async function realHost(): Promise<LectorHost> {
	const daemon = await startIsolatedLectorDaemon();
	stopDaemon = daemon.stop;
	host = createLectorHost({ operations: lectorOperationsFromClient(daemon.client) });
	await host.activate();
	return host;
}

describe("bootstrapWorkspace", () => {
	it("opens a real directory workspace and lists its bounded top-level entries", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-bootstrap-dir-"));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src/b.ts"), "export const b = 2;\n");

		const classified = classifyPath(root);
		if (classified.kind !== "directory") throw new Error("unreachable");
		const outcome = await bootstrapWorkspace(classified, await realHost());

		expect(outcome).toMatchObject({
			ok: true,
			value: { rootPath: root, kind: "directory", workspace: { kind: "workspace" } },
		});
		if (!outcome.ok) throw new Error("unreachable");
		expect(outcome.value.tree?.entries).toEqual(expect.arrayContaining([{ name: "a.ts", kind: "file" }, { name: "src", kind: "directory" }]));
	});

	it("opens a bare file directly, identifying its nearest real git repository as the workspace root", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-bootstrap-file-"));
		execFileSync("git", ["init", "-q"], { cwd: root });
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "src/a.ts"), "export function greet() {\n\treturn 'hi';\n}\n");

		const filePath = join(root, "src/a.ts");
		const classified = classifyPath(filePath);
		if (classified.kind !== "file") throw new Error("unreachable");
		const outcome = await bootstrapWorkspace(classified, await realHost());

		expect(outcome).toMatchObject({
			ok: true,
			value: { rootPath: root, rootTitle: expect.any(String), kind: "file", file: { path: "src/a.ts", content: expect.stringContaining("greet") } },
		});
	});

	it("falls back to a bare file's own directory when it is outside any git repository", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-bootstrap-nogit-"));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");

		const classified = classifyPath(join(root, "a.ts"));
		if (classified.kind !== "file") throw new Error("unreachable");
		const outcome = await bootstrapWorkspace(classified, await realHost());

		expect(outcome).toMatchObject({ ok: true, value: { rootPath: root, file: { path: "a.ts" } } });
	});

	it("returns a typed failure instead of throwing when the Lector daemon is unreachable", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-bootstrap-unreachable-"));
		const classified = classifyPath(root);
		if (classified.kind !== "directory") throw new Error("unreachable");
		const unreachableHost = createLectorHost({
			operations: {
				call: () => {
					throw new Error("connection refused");
				},
			},
		});
		await unreachableHost.activate();
		host = unreachableHost;

		expect(await bootstrapWorkspace(classified, unreachableHost)).toMatchObject({ ok: false, code: "lector-error" });
	});

	it("enforces the directory entry/byte bound as a typed failure, not an unbounded listing", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-bootstrap-bounds-"));
		for (let index = 0; index < 5; index++) writeFileSync(join(root, `file-${index}.ts`), "export const x = 1;\n");

		const classified = classifyPath(root);
		if (classified.kind !== "directory") throw new Error("unreachable");
		const outcome = await bootstrapWorkspace(classified, await realHost(), { maxEntries: 2, maxBytes: 1_000_000 });

		expect(outcome).toMatchObject({ ok: false, code: "resource-bound-exceeded" });
	});
});
