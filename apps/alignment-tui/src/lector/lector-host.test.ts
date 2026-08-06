import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/alignment-lector";
import { afterEach, describe, expect, it } from "vitest";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";
import { createLectorHost } from "./lector-host.js";

let root: string | undefined;
let stop: (() => Promise<void>) | undefined;

afterEach(async () => {
	await stop?.();
	stop = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("createLectorHost", () => {
	it("activates the real Lector contribution, executes its commands, and reads its resources", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-tui-lector-host-"));
		writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
		const daemon = await startIsolatedLectorDaemon();
		stop = daemon.stop;

		const host = createLectorHost({ operations: lectorOperationsFromClient(daemon.client) });
		await host.activate();
		const workspace = await host.execute("lector.workspace.open", { path: root });
		expect(workspace).toMatchObject({ ok: true, value: { kind: "workspace" } });
		if (!workspace.ok) throw new Error("unreachable");
		const tree = await host.read(workspace.value, { maxBytes: 100_000, maxEntries: 100 });
		expect(tree).toMatchObject({ ok: true, value: { kind: "tree" } });
		await host.dispose();
	});

	it("reports a typed failure for an unregistered command instead of throwing", async () => {
		const host = createLectorHost({ operations: { call: async () => ({}) } });
		await host.activate();
		expect(await host.execute("lector.not-a-real-command", {})).toMatchObject({ ok: false, code: "unknown-command" });
		await host.dispose();
	});

	it("refuses a second activation of the same host instance", async () => {
		const host = createLectorHost({ operations: { call: async () => ({}) } });
		await host.activate();
		await expect(host.activate()).rejects.toThrow(/already active/);
		await host.dispose();
	});
});
