import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/zodiac-lector";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLectorHost, type LectorHost } from "./lector-host.js";
import { openLectorEditorNatively, resolveNativeEditorTarget } from "./native-editor.js";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";

let root: string | undefined;
let stopDaemon: (() => Promise<void>) | undefined;
let lectorHost: LectorHost | undefined;

function nativeHost() {
	let mounted: Component | undefined;
	return {
		host: {
			showExternalComponent(component: Component): void {
				mounted = component;
			},
			hideExternalComponent(): void {
				mounted = undefined;
			},
			refresh(): void {},
			terminalRows(): number {
				return 24;
			},
		},
		mounted: () => mounted,
	};
}

async function realHost(): Promise<LectorHost> {
	const daemon = await startIsolatedLectorDaemon();
	stopDaemon = daemon.stop;
	lectorHost = createLectorHost({ operations: lectorOperationsFromClient(daemon.client) });
	await lectorHost.activate();
	return lectorHost;
}

async function waitForMounted(mounted: () => Component | undefined): Promise<Component> {
	return await vi.waitFor(
		() => {
			const component = mounted();
			if (!component) throw new Error("editor has not mounted yet");
			return component;
		},
		{ timeout: 5_000, interval: 20 },
	);
}

function typeKeys(component: Component, keys: readonly string[]): void {
	for (const key of keys) component.handleInput?.(key);
}

function plain(value: string): string {
	return value.replace(/\x1b\[[0-9;]*m/g, "");
}

afterEach(async () => {
	await lectorHost?.dispose();
	lectorHost = undefined;
	await stopDaemon?.();
	stopDaemon = undefined;
	if (root) rmSync(root, { recursive: true, force: true });
	root = undefined;
});

describe("active Lector buffer authority", () => {
	it("uses the dirty buffer or reports it stale", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-active-buffer-"));
		const filePath = join(root, "state.ts");
		const diskContent = "export const stableValue = 1;\n";
		writeFileSync(filePath, diskContent);
		const { host, mounted } = nativeHost();

		const opened = openLectorEditorNatively(host, await realHost(), filePath);
		const editor = await waitForMounted(mounted);

		// Add a symbol that exists only in the real ModalEditorComponent's dirty LiveBuffer,
		// then ask for semantic hover on that symbol before saving it to disk.
		typeKeys(editor, ["o", ...'export const dirtyOnly = "active";', "\x1b", "0", ...Array(13).fill("l"), "K"]);

		await vi.waitFor(
			() => {
				const status = plain(editor.render(80).at(-1) ?? "");
				expect(status).toMatch(/dirtyOnly|stale active buffer/i);
			},
			{ timeout: 5_000, interval: 20 },
		);
		expect(readFileSync(filePath, "utf8")).toBe(diskContent);

		typeKeys(editor, [":", "q", "\r"]);
		await opened;
	}, 15_000);

	it("rejects a foreign Workspace target", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-buffer-scope-"));
		const activeRoot = join(root, "active");
		const foreignRoot = join(root, "foreign");
		mkdirSync(activeRoot);
		mkdirSync(foreignRoot);
		const activeFile = join(activeRoot, "active.ts");
		const foreignFile = join(foreignRoot, "foreign.ts");
		writeFileSync(activeFile, "export const active = true;\n");
		writeFileSync(foreignFile, "export const foreign = true;\n");
		const host = await realHost();

		const accepted = await resolveNativeEditorTarget(host, activeFile, activeRoot);
		expect(accepted.ok).toBe(true);
		expect(await resolveNativeEditorTarget(host, foreignFile, activeRoot)).toEqual({
			ok: false,
			code: "foreign-workspace-resource",
			message: "Editor target is outside the active Workspace",
		});
	}, 15_000);
});
