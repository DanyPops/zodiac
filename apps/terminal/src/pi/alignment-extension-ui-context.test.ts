import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { createAlignmentExtensionUIContext, type AlignmentExtensionUIContextHost } from "./alignment-extension-ui-context.js";

function fakeHost(rows = 24): AlignmentExtensionUIContextHost & { shown: Component[]; hidden: number; refreshCount: number } {
	const host = {
		shown: [] as Component[],
		hidden: 0,
		refreshCount: 0,
		showExternalComponent(component: Component) {
			host.shown.push(component);
		},
		hideExternalComponent() {
			host.hidden++;
		},
		refresh() {
			host.refreshCount++;
		},
		terminalRows() {
			return rows;
		},
	};
	return host;
}

function componentRendering(lines: string[]): Component {
	return { render: () => lines, invalidate: () => {} };
}

describe("createAlignmentExtensionUIContext", () => {
	describe("custom()", () => {
		it("mounts the factory's returned Component via the host and resolves once done() fires", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			let capturedDone: ((result: string) => void) | undefined;
			const promise = ctx.custom<string>((_tui, _theme, _keybindings, done) => {
				capturedDone = done;
				return componentRendering(["mounted"]);
			});
			await Promise.resolve(); // let the factory's own microtask settle
			expect(host.shown).toHaveLength(1);
			expect(host.refreshCount).toBeGreaterThanOrEqual(1);
			capturedDone?.("result-value");
			await expect(promise).resolves.toBe("result-value");
			expect(host.hidden).toBe(1);
		});

		it("supports an async factory (a Promise-returning custom() call), matching the real interface's own signature", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.custom<undefined>(async (_tui, _theme, _keybindings, done) => {
				await Promise.resolve();
				const component = componentRendering(["async mounted"]);
				setTimeout(() => done(undefined), 0);
				return component;
			});
			await promise;
			expect(host.shown).toHaveLength(1);
			expect(host.hidden).toBe(1);
		});

		it("fakeTui.requestRender() calls back into the host's own refresh(), and terminal.rows reads live from the host, not a snapshot", async () => {
			const host = fakeHost(40);
			const ctx = createAlignmentExtensionUIContext(host);
			let observedRowsAtCall: number | undefined;
			const promise = ctx.custom<undefined>((tui, _theme, _keybindings, done) => {
				tui.requestRender();
				observedRowsAtCall = tui.terminal.rows;
				done(undefined);
				return componentRendering(["x"]);
			});
			await promise;
			expect(observedRowsAtCall).toBe(40);
			expect(host.refreshCount).toBeGreaterThan(0);
		});

		it("theme.fg() emits real SGR codes for a syntax color a real editor factory calls, recoverable by parseAnsiLine", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			let styled: string | undefined;
			const promise = ctx.custom<undefined>((_tui, theme, _keybindings, done) => {
				styled = theme.fg("syntaxKeyword", "const");
				done(undefined);
				return componentRendering(["x"]);
			});
			await promise;
			expect(styled).toContain("const");
			expect(styled).toMatch(/\x1b\[3\dm/);
		});
	});

	// Real synthetic keystrokes routed through the mounted TitledComponent's own
	// handleInput -- not reaching into onSelect/onSubmit callback properties
	// directly, since the object actually mounted (and returned to the host) is
	// the *wrapper*, not the inner SelectList/Input. This exercises the real
	// integration: raw bytes -> pi-tui's own real key handling -> the callback
	// this module wires to done() -- exactly how a real terminal session drives
	// it via SemanticShellApplication.handleInput's own external-focus routing.
	const DOWN = "\x1b[B";
	const ENTER = "\r";
	const ESCAPE = "\x1b";

	describe("select()", () => {
		it("resolves with the chosen option once Enter is pressed after moving the selection", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.select("Pick one", ["alpha", "beta"]);
			await Promise.resolve();
			const mounted = host.shown[0]!;
			mounted.handleInput?.(DOWN);
			mounted.handleInput?.(ENTER);
			await expect(promise).resolves.toBe("beta");
		});

		it("resolves undefined immediately for an empty option list, without mounting anything", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			await expect(ctx.select("Pick one", [])).resolves.toBeUndefined();
			expect(host.shown).toHaveLength(0);
		});

		it("resolves undefined once Escape is pressed", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.select("Pick one", ["alpha"]);
			await Promise.resolve();
			host.shown[0]!.handleInput?.(ESCAPE);
			await expect(promise).resolves.toBeUndefined();
		});
	});

	describe("confirm()", () => {
		it("resolves true when Enter is pressed on the default (first) choice, Yes", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.confirm("Delete?", "This cannot be undone");
			await Promise.resolve();
			host.shown[0]!.handleInput?.(ENTER);
			await expect(promise).resolves.toBe(true);
		});

		it("resolves false when the user moves down to No and presses Enter", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.confirm("Delete?", "This cannot be undone");
			await Promise.resolve();
			const mounted = host.shown[0]!;
			mounted.handleInput?.(DOWN);
			mounted.handleInput?.(ENTER);
			await expect(promise).resolves.toBe(false);
		});
	});

	describe("input()", () => {
		it("resolves with the typed value once Enter is pressed", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.input("Name?");
			await Promise.resolve();
			const mounted = host.shown[0]!;
			for (const char of "hi") mounted.handleInput?.(char);
			mounted.handleInput?.(ENTER);
			await expect(promise).resolves.toBe("hi");
		});

		it("resolves undefined once Escape is pressed", async () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			const promise = ctx.input("Name?");
			await Promise.resolve();
			host.shown[0]!.handleInput?.(ESCAPE);
			await expect(promise).resolves.toBeUndefined();
		});
	});

	describe("no-op members, matching pi-coding-agent's own noOpUIContext defaults", () => {
		it("notify/setStatus/setWidget/etc never throw and do nothing observable", () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			expect(() => ctx.notify("hi")).not.toThrow();
			expect(() => ctx.setStatus("k", "v")).not.toThrow();
			expect(() => ctx.setWidget("k", undefined)).not.toThrow();
			expect(ctx.getEditorText()).toBe("");
			expect(ctx.getToolsExpanded()).toBe(false);
			expect(ctx.setTheme("dark")).toEqual({ success: false, error: "UI not available" });
			expect(ctx.getAllThemes()).toEqual([]);
			expect(ctx.onTerminalInput(vi.fn())()).toBeUndefined();
		});

		it("theme getter returns something with a working fg()", () => {
			const host = fakeHost();
			const ctx = createAlignmentExtensionUIContext(host);
			expect(ctx.theme.fg("error", "boom")).toContain("boom");
		});
	});
});
