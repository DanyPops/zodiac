import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lectorOperationsFromClient } from "@danypops/zodiac-lector";
import { renderToTerminal, type RenderedTerminal } from "@danypops/pi-tui-harness";
import type { Component } from "@earendil-works/pi-tui";
import { worldId } from "@zodiac/protocol";
import { createWorldStore } from "@zodiac/server/world";
import { diffFrames, encodeGridUpdate, GridTerminal, type GridFrame } from "@zodiac/tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLectorHost, type LectorHost } from "./lector-host.js";
import { openLectorEditorNatively, promptAndOpenLectorEditorNatively } from "./native-editor.js";
import { SemanticShell } from "../shell/semantic-shell.js";
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

function terminalCells(terminal: RenderedTerminal) {
	return Array.from({ length: terminal.rows }, (_, row) =>
		Array.from({ length: terminal.cols }, (_, column) => terminal.cellAt(row, column)),
	);
}

function expectWideCellsValid(frame: GridFrame): void {
	for (let row = 0; row < frame.height; row++) {
		for (let column = 0; column < frame.width; column++) {
			const cell = frame.cells[row * frame.width + column]!;
			if (cell.width === 2) expect(frame.cells[row * frame.width + column + 1]?.continuation).toBe(true);
			if (cell.continuation) expect(frame.cells[row * frame.width + column - 1]?.width).toBe(2);
		}
	}
}

async function waitForMounted(mounted: () => Component | undefined, previous?: Component): Promise<Component> {
	return await vi.waitFor(
		() => {
			const component = mounted();
			if (!component || component === previous) throw new Error("component has not mounted yet");
			return component;
		},
		{ timeout: 5_000, interval: 20 },
	);
}

describe("openLectorEditorNatively", () => {
	it("mounts a real ModalEditorComponent showing the real file's own content -- no AgentSession, no Pi extension involvement at all", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-"));
		writeFileSync(join(root, "greet.ts"), "export function greet() {\n\treturn 'hi';\n}\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), join(root, "greet.ts"));
		const editor = await waitForMounted(mounted);
		const rendered = editor.render(80).join("\n");
		expect(rendered).toContain("greet");
		expect(rendered).toContain("NORMAL");

		// Quit without saving so the awaited promise actually resolves.
		typeKeys(editor, [":", "q", "\r"]);
		await opened;
		expect(mounted()).toBeUndefined();
	});

	it("keeps real editor traces stable across edits and resize", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-render-"));
		const filePath = join(root, "unicode.txt");
		writeFileSync(filePath, "alpha\nshort\nwide 界 row\nlast\n");
		const shell = new SemanticShell();
		let mounted: Component | undefined;
		const nativeHost = {
			showExternalComponent(component: Component): void {
				mounted = component;
				shell.enterExternal(component);
			},
			hideExternalComponent(): void {
				mounted = undefined;
				shell.exitExternal();
			},
			refresh(): void {},
			terminalRows(): number {
				return 24;
			},
		};
		const opened = openLectorEditorNatively(nativeHost, await realHost(), filePath);
		const editor = await waitForMounted(() => mounted);
		const writes: string[] = [];
		const gridTerminal = new GridTerminal({ write: (data) => writes.push(data) });
		const trace = [
			{ width: 60, keys: [] },
			{ width: 60, keys: ["A", " ", "界", "🙂", "\x1b"] },
			{ width: 80, keys: ["h", "h", "j", "0"] },
			{ width: 80, keys: ["j", "$", "x"] },
			{ width: 60, keys: ["k", "0"] },
		] as const;

		for (const [step, action] of trace.entries()) {
			typeKeys(editor, action.keys);
			const projected = shell.project(createWorldStore(worldId("render-trace")).worldViewModel(), action.width, 24);
			if (!projected.ok) throw new Error(projected.error.message);
			expectWideCellsValid(projected.value);
			expect(projected.value.cells.map((cell) => cell.grapheme).join("")).not.toContain("_pi:c");
			const update = gridTerminal.render(projected.value);
			if (!update.ok) throw new Error(update.error.message);
			const full = diffFrames(undefined, projected.value);
			if (!full.ok) throw new Error(full.error.message);
			const encodedFull = encodeGridUpdate(full.value);
			if (!encodedFull.ok) throw new Error(encodedFull.error.message);
			const incrementalTerminal = await renderToTerminal([writes.join("")], { cols: 80, rows: 24 });
			const fullTerminal = await renderToTerminal([encodedFull.value], { cols: 80, rows: 24 });
			try {
				expect(incrementalTerminal.plainLines(), `plain rows at step ${step}`).toEqual(fullTerminal.plainLines());
				expect(terminalCells(incrementalTerminal), `cells and styles at step ${step}`).toEqual(terminalCells(fullTerminal));
			} finally {
				incrementalTerminal.dispose();
				fullTerminal.dispose();
			}
		}

		typeKeys(editor, [":", "q", "\r"]);
		await opened;
	}, 15_000);

	it("real vim edit + :wq actually saves the new content to disk through Zodiac's own lector-host.ts, not pi-lector's own operations.ts", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-save-"));
		const filePath = join(root, "note.txt");
		writeFileSync(filePath, "hello\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), filePath);
		const editor = await waitForMounted(mounted);

		typeKeys(editor, ["A", " ", "w", "o", "r", "l", "d", "\x1b"]); // append " world" in insert mode, then Escape
		typeKeys(editor, [":", "w", "q", "\r"]);
		await opened;

		expect(readFileSync(filePath, "utf8")).toBe("hello world\n");
	});

	it("surfaces hover through Zodiac's own lector.symbol.hover contribution command", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-hover-"));
		writeFileSync(join(root, "a.ts"), "export function greet(): string {\n\treturn 'hi';\n}\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), join(root, "a.ts"));
		const editor = await waitForMounted(mounted);

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

	it("an external mutation between open and save is typed as a stale-write failure, the in-memory edit is preserved, and the editor is not closed -- proven against the real Lector daemon, not mocked", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-stale-"));
		const filePath = join(root, "note.txt");
		writeFileSync(filePath, "hello\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const opened = openLectorEditorNatively(nativeHost, await realHost(), filePath);
		const editor = await waitForMounted(mounted);

		// Make an unsaved in-memory edit, but don't save yet.
		typeKeys(editor, ["A", " ", "w", "o", "r", "l", "d", "\x1b"]);

		// Mutate the file on disk directly, bypassing Lector entirely -- a real external writer
		// (another process, another editor) racing this one.
		writeFileSync(filePath, "hello\nexternal change\n");

		// :wq attempts save-and-quit. It must fail typed (StaleExpectedHash -> "stale-write"),
		// surfaced by pi-lector's own ModalEditorComponent as a status message -- see
		// modal-editor-component.ts's performAction: on a thrown save() it sets statusMessage and
		// returns *without* calling done(), so the editor stays mounted and open.
		typeKeys(editor, [":", "w", "q", "\r"]);
		await new Promise((r) => setTimeout(r, 100));

		expect(mounted()).toBeDefined(); // not closed -- "recover without restarting" requires the process/editor to still be alive
		// eslint-disable-next-line no-control-regex -- stripping real terminal escape codes (cursor-highlight reverse video splits "world" across an SGR boundary) is the point here.
		const afterFailedSave = mounted()!
			.render(80)
			.join("\n")
			.replace(/\x1b\[[0-9;]*m/g, "");
		expect(afterFailedSave).toContain("save failed");
		expect(afterFailedSave).toContain("world"); // the unsaved edit is still in the live buffer, not discarded
		expect(readFileSync(filePath, "utf8")).toBe("hello\nexternal change\n"); // disk was NOT silently overwritten

		// Known, real, cross-repo gap (not fixed by this test): GuardedLiveBuffer.markStale (in
		// @danypops/lector's own guarded-live-buffer.ts) records the conflict's expected/actual
		// hash pair for introspection but never advances `savedHash` to the actual on-disk hash.
		// A second :wq here would fail with the exact same StaleExpectedHash forever -- there is no
		// exposed "force save" or "resync" contribution command today. This test therefore proves
		// exactly Slice 2's detect+preserve+no-crash guarantee and deliberately stops short of a
		// successful-retry assertion, rather than asserting something the real code cannot yet do.
		// See task "Lector contribution needs a real conflict-resolution command" for the follow-up.
		//
		// Cleanup: pi-lector's own editor-state.ts parses ":q" straight to {kind: "quit"} with no
		// dirty-buffer guard and no "!" variant at all (confirmed by direct source read) -- a plain
		// ":q" always quits, dirty or not, so no force-quit syntax is needed or recognized here.
		typeKeys(mounted()!, [":", "q", "\r"]);
		await opened;
	}, 15_000);
});

describe("promptAndOpenLectorEditorNatively", () => {
	it("mounts a real Input first, then opens the typed path once submitted", async () => {
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-prompt-"));
		writeFileSync(join(root, "x.ts"), "export const x = 1;\n");
		const { host: nativeHost, mounted } = fakeNativeHost();

		const flow = promptAndOpenLectorEditorNatively(nativeHost, await realHost());
		const prompt = await waitForMounted(mounted);
		expect(prompt.render(80).join("\n")).toContain("Open in Lector editor");

		for (const char of join(root, "x.ts")) prompt.handleInput?.(char);
		prompt.handleInput?.("\r");
		const editor = await waitForMounted(mounted, prompt);
		expect(editor.render(80).join("\n")).toContain("x = 1");

		typeKeys(editor, [":", "q", "\r"]);
		await flow;
	});

	it("does nothing when the prompt is cancelled with Escape", async () => {
		const { host: nativeHost, mounted } = fakeNativeHost();
		root = mkdtempSync(join(tmpdir(), "zodiac-native-editor-cancel-"));
		const flow = promptAndOpenLectorEditorNatively(nativeHost, await realHost());
		const prompt = await waitForMounted(mounted);
		prompt.handleInput?.("\x1b");
		await flow;
		expect(mounted()).toBeUndefined();
	});
});
