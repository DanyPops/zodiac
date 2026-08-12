import { dirname, relative } from "node:path";
import type { ContributionReadBounds, ContributionResourceReference } from "@zodiac/protocol";
import { ModalEditorComponent, type ModalEditorHost } from "@danypops/pi-lector/editor";
import type { Component } from "@earendil-works/pi-tui";
import { Input } from "@earendil-works/pi-tui";
import { nearestGitRoot } from "../bootstrap/nearest-git-root.js";
import { workspaceIdFromReference } from "../bootstrap/workspace-bootstrap.js";
import { createZodiacEditorTheme, TitledComponent } from "../pi/zodiac-extension-ui-context.js";
import type { LectorHost } from "./lector-host.js";

/**
 * Zodiac's own native host surface for mounting a real Lector editor Component --
 * deliberately the same shape as ZodiacExtensionUIContextHost (showExternalComponent/
 * hideExternalComponent/refresh/terminalRows), since both ultimately mount into the exact same
 * SemanticShellApplication machinery, but this one has zero Pi-extension involvement: no
 * AgentSession, no ExtensionRunner, no session.prompt()/slash-command dispatch, no chat-history
 * side effect at all. See Doc "Alignment: host Lector's editor natively via mountComponent" for
 * why this exists as a second, independent path rather than reusing ZodiacExtensionUIContext
 * itself -- that facade is scoped to the generic in-process-AgentSession-extension case; this one
 * is Zodiac's own first-party integration with Lector specifically.
 */
export interface NativeEditorHost {
	showExternalComponent(component: Component): void;
	hideExternalComponent(): void;
	refresh(): void;
	terminalRows(): number;
}

const READ_BOUNDS: ContributionReadBounds = { maxBytes: 4 * 1024 * 1024, maxEntries: 10_000 };

function record(value: unknown): Record<string, unknown> | undefined {
	// Defensive-parse convention already used identically by workspace-bootstrap.ts,
	// alignment-lector's own contribution.ts, and semantic-navigation.ts -- kept local rather than
	// shared, per this codebase's own established convention for this exact tiny helper.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Shared with native-explorer.ts -- both mount a real pi-lector Component against the exact same narrow {requestRender, terminal.rows} coupling surface, proven live for ModalEditorComponent and structurally identical for ExplorerComponent (same EditorState engine underneath). */
export function fakeTui(host: NativeEditorHost): { requestRender(): void; terminal: { rows: number } } {
	return {
		requestRender: () => host.refresh(),
		terminal: {
			get rows() {
				return host.terminalRows();
			},
		},
	};
}

/** A LiveBuffer-shaped mutation port -- exactly what alignment-lector's own tracked GuardedLiveBuffer.buffer already is, narrowed to only what save() below needs. Kept as a small structural type rather than importing Lector's real LiveBuffer class as a type dependency this app doesn't otherwise need. */
interface ReplaceableBuffer {
	readonly length: number;
	replace(from: number, to: number, text: string): void;
}

function replaceableBuffer(value: unknown): ReplaceableBuffer | undefined {
	// A "text" resource read returns {..., editor: GuardedLiveBuffer, ...}, and GuardedLiveBuffer's
	// own field is named `buffer` (a LiveBuffer) -- two levels of nesting, not one.
	const parsed = record(value);
	const editor = parsed?.editor === undefined ? undefined : record(parsed.editor);
	const buffer = editor?.buffer === undefined ? undefined : record(editor.buffer);
	if (!buffer || typeof buffer.length !== "number" || typeof buffer.replace !== "function") return undefined;
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
	return buffer as unknown as ReplaceableBuffer;
}

function hoverContents(value: unknown): string | undefined {
	const parsed = record(value);
	const hover = parsed?.hover === undefined ? undefined : record(parsed.hover);
	return typeof hover?.contents === "string" ? hover.contents : undefined;
}

/**
 * Builds a ModalEditorHost backed entirely by Alignment's own existing lector-host.ts
 * contribution commands (lector.file.open/save, lector.symbol.hover) -- confirmed by direct
 * source read that both already exist in @danypops/alignment-lector, no new contribution code
 * needed. save() reaches into the tracked resource's own GuardedLiveBuffer (returned as the
 * `editor` field of a "text" resource read) and replaces its whole content before calling
 * lector.file.save, since that command persists whatever is currently in the tracked buffer
 * rather than accepting an arbitrary text parameter directly.
 */
function createLectorEditorHost(lectorHost: LectorHost, workspaceId: string, absolutePath: string, relativePath: string): ModalEditorHost {
	async function currentResource(): Promise<ContributionResourceReference> {
		const opened = await lectorHost.execute("lector.file.open", { workspaceId, path: relativePath });
		if (!opened.ok) throw new Error(`Could not open "${absolutePath}": ${opened.message}`);
		return opened.value;
	}

	return {
		filePath: absolutePath,
		async save(text) {
			const resource = await currentResource();
			const read = await lectorHost.read(resource, READ_BOUNDS);
			if (!read.ok) throw new Error(`Could not read "${absolutePath}" before saving: ${read.message}`);
			const parsed = record(read.value);
			const buffer = replaceableBuffer(parsed);
			if (!buffer) throw new Error(`Lector returned an unrecognized editor buffer for "${absolutePath}"`);
			buffer.replace(0, buffer.length, text);
			const saved = await lectorHost.execute("lector.file.save", { resource });
			if (!saved.ok) throw new Error(saved.message);
		},
		async hover(line, character) {
			const outcome = await lectorHost.execute("lector.symbol.hover", { workspaceId, path: relativePath, line, character });
			if (!outcome.ok) return undefined;
			const read = await lectorHost.read(outcome.value, READ_BOUNDS);
			if (!read.ok) return undefined;
			const contents = hoverContents(read.value);
			return contents === undefined ? undefined : { contents };
		},
	};
}

/**
 * Opens `absolutePath` in a real Lector editor, mounted natively -- no AgentSession, no
 * ExtensionRunner, no Pi extension involvement at all. Resolves the file's nearest git root as
 * its Lector workspace (mirroring bootstrapWorkspace's own convention), opens both through the
 * existing lector-host.ts contribution commands, constructs a real ModalEditorComponent against
 * a fake tui/theme (the same real, working substitutes ZodiacExtensionUIContext already
 * proved live against this exact Component), and mounts it via host.showExternalComponent() --
 * the same full-viewport mechanism the Pi-extension-facade path already uses, reused here because
 * Zodiac's TUI has no other Surface-hosting mechanism yet (see the Window/Surface-docking
 * discussion this task deliberately excludes from scope).
 */
export async function openLectorEditorNatively(host: NativeEditorHost, lectorHost: LectorHost, absolutePath: string): Promise<void> {
	const rootPath = nearestGitRoot(dirname(absolutePath)) ?? dirname(absolutePath);
	const opened = await lectorHost.execute("lector.workspace.open", { path: rootPath });
	if (!opened.ok) throw new Error(`Could not open workspace for "${absolutePath}": ${opened.message}`);
	const workspaceId = workspaceIdFromReference(opened.value);
	if (!workspaceId) throw new Error(`Lector returned an unrecognized workspace resource for "${absolutePath}"`);
	const relativePath = relative(rootPath, absolutePath);

	const fileOpened = await lectorHost.execute("lector.file.open", { workspaceId, path: relativePath });
	if (!fileOpened.ok) throw new Error(`Could not open "${absolutePath}": ${fileOpened.message}`);
	const read = await lectorHost.read(fileOpened.value, READ_BOUNDS);
	if (!read.ok) throw new Error(`Could not read "${absolutePath}": ${read.message}`);
	const parsed = record(read.value);
	const content = typeof parsed?.content === "string" ? parsed.content : undefined;
	if (content === undefined) throw new Error(`Lector returned an unrecognized file read for "${absolutePath}"`);

	const editorHost = createLectorEditorHost(lectorHost, workspaceId, absolutePath, relativePath);
	const theme = createZodiacEditorTheme();
	await new Promise<void>((resolve) => {
		function done(): void {
			host.hideExternalComponent();
			host.refresh();
			resolve();
		}
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- same pragmatic
		// cast ZodiacExtensionUIContext already relies on: ModalEditorComponent's real coupling
		// surface is exactly {requestRender, terminal.rows} and {fg, bg}, proven by direct source
		// read, not pi-coding-agent's full TUI/Theme classes (which have private fields no plain
		// object can satisfy structurally).
		const component = new ModalEditorComponent(fakeTui(host) as any, theme as any, editorHost, content, done);
		host.showExternalComponent(component);
		host.refresh();
	});
}

/**
 * Prompts for a file path via a real mounted Input Component (the same primitive
 * ZodiacExtensionUIContext.input() uses), then opens it natively. The interim invocation UI
 * until a real file browser exists (deliberately out of scope for this task).
 */
export async function promptAndOpenLectorEditorNatively(host: NativeEditorHost, lectorHost: LectorHost): Promise<void> {
	const path = await new Promise<string | undefined>((resolve) => {
		function done(value: string | undefined): void {
			host.hideExternalComponent();
			host.refresh();
			resolve(value);
		}
		const field = new Input();
		field.onSubmit = (value) => done(value);
		field.onEscape = () => done(undefined);
		host.showExternalComponent(new TitledComponent("Open in Lector editor -- absolute file path", field));
		host.refresh();
	});
	if (path && path.trim().length > 0) await openLectorEditorNatively(host, lectorHost, path.trim());
}
