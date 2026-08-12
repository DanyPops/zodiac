import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/alignment-lector";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { createLectorHost, type LectorHost } from "./lector-host.js";
import { openLectorExplorerNatively } from "./native-explorer.js";
import { startIsolatedLectorDaemon } from "../test/isolated-lector-daemon.js";

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

/** Same "record, don't render" fake native-editor.test.ts already uses. */
function fakeNativeHost() {
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

function typeKeys(component: Component, keys: readonly string[]): void {
	for (const key of keys) component.handleInput?.(key);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("openLectorExplorerNatively", () => {
	it("mounts a real ExplorerComponent listing a real directory's own entries -- no AgentSession, no Pi extension involvement at all", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "readme.md"), "hello\n");
		writeFileSync(join(root, "src", "index.ts"), "export {};\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		expect(mounted()).toBeDefined();
		const rendered = mounted()!.render(80).join("\n");
		expect(rendered).toContain("src/");
		expect(rendered).toContain("readme.md");
		expect(rendered).toContain("NORMAL");

		typeKeys(mounted()!, [":", "q", "\r"]);
		await opened;
		expect(mounted()).toBeUndefined();
	});

	it("Enter on a file hands off to the real editor through pi-lector's own runExplorerFlow, and :q from the editor returns to the explorer at that file's own directory", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-handoff-"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "readme.md"), "hello world\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		const explorer = mounted();
		if (!explorer) throw new Error("explorer never mounted");

		// Directories sort before files, alphabetical within each group -- "1 src/", "2 readme.md".
		typeKeys(explorer, ["j", "\r"]);
		await sleep(200);
		const editor = mounted();
		if (!editor) throw new Error("editor never mounted after Enter on a file");
		expect(editor).not.toBe(explorer);
		// Not "hello world" verbatim -- the cursor's own inverse-video escape sequence sits on top of
		// its first character ('h') by default, splitting the literal substring.
		expect(editor.render(80).join("\n")).toContain("ello world");

		typeKeys(editor, [":", "q", "\r"]);
		await sleep(200);
		const backToExplorer = mounted();
		if (!backToExplorer) throw new Error("explorer never remounted after the editor quit");
		expect(backToExplorer).not.toBe(editor);
		expect(backToExplorer.render(80).join("\n")).toContain("readme.md");

		typeKeys(backToExplorer, [":", "q", "\r"]);
		await opened;
		expect(mounted()).toBeUndefined();
	});

	it("creates a real file on disk through the mounted explorer's own oil.nvim-style buffer edit (lector.file.create end to end)", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-create-"));
		writeFileSync(join(root, "existing.txt"), "x\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		const explorer = mounted();
		if (!explorer) throw new Error("explorer never mounted");

		// "o" opens a new line below the cursor and enters insert mode -- a brand-new line with no
		// id prefix is a create once confirmed.
		typeKeys(explorer, ["o", ...[..."new-file.txt"], "\x1b", ":", "w", "\r"]);
		await sleep(80);
		expect(explorer.render(80).join("\n")).toContain("Pending changes:");
		typeKeys(explorer, ["y"]);
		await sleep(150);

		expect(readFileSync(join(root, "new-file.txt"), "utf8")).toBe("");
		typeKeys(explorer, [":", "q", "\r"]);
		await opened;
	});

	it("renames a real file on disk through the mounted explorer (lector.path.rename end to end)", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-rename-"));
		writeFileSync(join(root, "old.txt"), "content\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		const explorer = mounted();
		if (!explorer) throw new Error("explorer never mounted");

		// Move to the end of the one entry's own line and rewrite its name in place -- same
		// technique pi-lector's own explorer-component.test.ts uses for a rename.
		typeKeys(explorer, ["$", "a", ..."old.txt".split("").map(() => "\x7f"), ..."renamed.txt", "\x1b", ":", "w", "\r"]);
		await sleep(80);
		expect(explorer.render(80).join("\n")).toContain("Pending changes:");
		typeKeys(explorer, ["y"]);
		await sleep(150);

		expect(existsSync(join(root, "old.txt"))).toBe(false);
		expect(readFileSync(join(root, "renamed.txt"), "utf8")).toBe("content\n");
		typeKeys(explorer, [":", "q", "\r"]);
		await opened;
	});

	it("deletes a real file on disk through the mounted explorer's dd + :w + y (lector.file.delete end to end)", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-delete-"));
		writeFileSync(join(root, "gone.txt"), "x\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		const explorer = mounted();
		if (!explorer) throw new Error("explorer never mounted");

		typeKeys(explorer, ["d", "d", ":", "w", "\r"]);
		await sleep(80);
		expect(explorer.render(80).join("\n")).toContain("Pending changes:");
		typeKeys(explorer, ["y"]);
		await sleep(150);

		expect(existsSync(join(root, "gone.txt"))).toBe(false);
		typeKeys(explorer, [":", "q", "\r"]);
		await opened;
	});

	it("creates a real directory on disk through the mounted explorer (lector.directory.create end to end)", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-explorer-mkdir-"));
		writeFileSync(join(root, "existing.txt"), "x\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorExplorerNatively(nativeHost, await realHost(), root);
		await sleep(80);
		const explorer = mounted();
		if (!explorer) throw new Error("explorer never mounted");

		// A trailing slash on a brand-new (no id prefix) line means "create as a directory" --
		// oil.nvim's own convention, matched by explorer-diff.ts's own parseExplorerLine.
		typeKeys(explorer, ["o", ..."newdir/", "\x1b", ":", "w", "\r"]);
		await sleep(80);
		expect(explorer.render(80).join("\n")).toContain("Pending changes:");
		typeKeys(explorer, ["y"]);
		await sleep(150);

		expect(existsSync(join(root, "newdir"))).toBe(true);
		typeKeys(explorer, [":", "q", "\r"]);
		await opened;
	});
});
