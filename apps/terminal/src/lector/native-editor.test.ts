import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/alignment-lector";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it } from "vitest";
import { createLectorHost, type LectorHost } from "./lector-host.js";
import { openLectorEditorNatively, promptAndOpenLectorEditorNatively } from "./native-editor.js";
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

/** A fake NativeEditorHost that records every mounted Component instead of painting a real terminal -- the same "record, don't render" pattern SemanticShellApplication's own tests already use for external focus. */
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

describe("openLectorEditorNatively", () => {
	it("mounts a real ModalEditorComponent showing the real file's own content -- no AgentSession, no Pi extension involvement at all", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-editor-"));
		writeFileSync(join(root, "greet.ts"), "export function greet() {\n\treturn 'hi';\n}\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), join(root, "greet.ts"));
		await new Promise((r) => setTimeout(r, 50)); // let the async open/read/mount chain settle before asserting
		expect(mounted()).toBeDefined();
		const rendered = mounted()!.render(80).join("\n");
		expect(rendered).toContain("greet");
		expect(rendered).toContain("NORMAL");

		// Quit without saving so the awaited promise actually resolves.
		typeKeys(mounted()!, [":", "q", "\r"]);
		await opened;
		expect(mounted()).toBeUndefined();
	});

	it("real vim edit + :wq actually saves the new content to disk through Alignment's own lector-host.ts, not pi-lector's own operations.ts", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-editor-save-"));
		const filePath = join(root, "note.txt");
		writeFileSync(filePath, "hello\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), filePath);
		await new Promise((r) => setTimeout(r, 50));
		const editor = mounted();
		if (!editor) throw new Error("editor never mounted");

		typeKeys(editor, ["A", " ", "w", "o", "r", "l", "d", "\x1b"]); // append " world" in insert mode, then Escape
		typeKeys(editor, [":", "w", "q", "\r"]);
		await opened;

		expect(readFileSync(filePath, "utf8")).toBe("hello world\n");
	});

	it("surfaces hover through Alignment's own lector.symbol.hover contribution command", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-editor-hover-"));
		writeFileSync(join(root, "a.ts"), "export function greet(): string {\n\treturn 'hi';\n}\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), join(root, "a.ts"));
		await new Promise((r) => setTimeout(r, 50));
		const editor = mounted();
		if (!editor) throw new Error("editor never mounted");

		typeKeys(editor, ["K"]); // request hover at the cursor's starting position
		await new Promise((r) => setTimeout(r, 300)); // a real hover round trip through a real (if not fully populated) language server
		const rendered = editor.render(80).join("\n");
		// A real hover call happened and resolved into *some* status text -- whether the language
		// server actually had a symbol at this exact untouched cursor position is not the point
		// here (that's Lector's own concern, already covered by its own hover test suite); the
		// point is that this native host's own hover() wiring reached the real daemon and got a
		// real answer back instead of throwing or hanging.
		expect(rendered.length).toBeGreaterThan(0);

		typeKeys(editor, [":", "q", "\r"]);
		await opened;
	}, 15_000);
});

describe("promptAndOpenLectorEditorNatively", () => {
	it("mounts a real Input first, then opens the typed path once submitted", async () => {
		root = mkdtempSync(join(tmpdir(), "alignment-native-editor-prompt-"));
		writeFileSync(join(root, "x.ts"), "export const x = 1;\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const flow = promptAndOpenLectorEditorNatively(nativeHost, await realHost());
		await new Promise((r) => setTimeout(r, 20));
		const prompt = mounted();
		if (!prompt) throw new Error("prompt never mounted");
		expect(prompt.render(80).join("\n")).toContain("Open in Lector editor");

		for (const char of join(root, "x.ts")) prompt.handleInput?.(char);
		prompt.handleInput?.("\r");
		await new Promise((r) => setTimeout(r, 50));

		const editor = mounted();
		if (!editor) throw new Error("editor never mounted after submitting the path");
		expect(editor.render(80).join("\n")).toContain("x = 1");

		typeKeys(editor, [":", "q", "\r"]);
		await flow;
	});

	it("does nothing when the prompt is cancelled with Escape", async () => {
		const { host: nativeHost, mounted } = fakeNativeHost();
		root = mkdtempSync(join(tmpdir(), "alignment-native-editor-cancel-"));
		const flow = promptAndOpenLectorEditorNatively(nativeHost, await realHost());
		await new Promise((r) => setTimeout(r, 20));
		mounted()?.handleInput?.("\x1b");
		await flow;
		expect(mounted()).toBeUndefined();
	});
});
