/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { panelId } from "@zodiac/protocol";
import { registerCue, listCues, runCue } from "./cues.js";

afterEach(cleanup);

/** A minimal fixture mirroring how a real component (e.g. CategoryCard) registers itself in its own mount effect -- never a separate hand-maintained list. */
function CueTarget({ id, onUnregistered }: { readonly id: string; readonly onUnregistered?: () => void }): null {
	useEffect(() => {
		const unregister = registerCue({ kind: "gallery-category", id }, { cue: "highlight", description: "Highlights this category card." });
		return () => {
			unregister();
			onUnregistered?.();
		};
	}, [id]);
	return null;
}

describe("registerCue / listCues", () => {
	it("a component registering on mount appears in listCues()", () => {
		render(<CueTarget id="filesystem" />);
		expect(listCues()).toContainEqual({ kind: "gallery-category", id: "filesystem", cue: "highlight", description: "Highlights this category card." });
	});

	it("unmounting removes the registration", () => {
		const { unmount } = render(<CueTarget id="terminal" />);
		expect(listCues().some((entry) => entry.id === "terminal")).toBe(true);
		unmount();
		expect(listCues().some((entry) => entry.id === "terminal")).toBe(false);
	});

	it("registering the same target id twice throws", () => {
		render(<CueTarget id="dup" />);
		expect(() => registerCue({ kind: "gallery-category", id: "dup" }, { cue: "highlight", description: "second" })).toThrow(/already registered/i);
	});
});

describe("runCue", () => {
	it("a command-intent cue calls the injected applyCommandIntent with the exact intent", async () => {
		const unregister = registerCue(
			{ kind: "panel", id: "workspace-nav" },
			{ cue: "expand", description: "Expands the pillar.", effect: { kind: "command-intent", intent: { type: "panel.resize", panelId: panelId("workspace-nav"), thickness: 256 } } },
		);
		const applyCommandIntent = vi.fn();
		const executeLocalCommand = vi.fn();
		await runCue("workspace-nav", { applyCommandIntent, executeLocalCommand });
		expect(applyCommandIntent).toHaveBeenCalledExactlyOnceWith({ type: "panel.resize", panelId: panelId("workspace-nav"), thickness: 256 });
		expect(executeLocalCommand).not.toHaveBeenCalled();
		unregister();
	});

	it("a local-command cue calls the injected executeLocalCommand with the right id", async () => {
		const unregister = registerCue({ kind: "dialog", id: "gallery" }, { cue: "open", description: "Opens the gallery.", effect: { kind: "local-command", commandId: "templates.openGallery" } });
		const applyCommandIntent = vi.fn();
		const executeLocalCommand = vi.fn();
		await runCue("gallery", { applyCommandIntent, executeLocalCommand });
		expect(executeLocalCommand).toHaveBeenCalledExactlyOnceWith("templates.openGallery");
		expect(applyCommandIntent).not.toHaveBeenCalled();
		unregister();
	});

	it("a cue with no effect awaits its own cosmetic run(), which resolves only once a real transitionend fires -- not a fixed timer", async () => {
		const el = document.createElement("div");
		el.style.transition = "opacity 10ms";
		document.body.appendChild(el);

		const unregister = registerCue(
			{ kind: "gallery-category", id: "highlight-me" },
			{
				cue: "highlight",
				description: "Highlights the card.",
				run: () =>
					new Promise<void>((resolve) => {
						el.addEventListener("transitionend", () => resolve(), { once: true });
						el.style.opacity = "0.5";
					}),
			},
		);

		let resolved = false;
		const promise = runCue("highlight-me", { applyCommandIntent: vi.fn(), executeLocalCommand: vi.fn() }).then(() => {
			resolved = true;
		});
		// Not resolved synchronously, nor after a macrotask -- only the real transitionend settles it.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(resolved).toBe(false);

		el.dispatchEvent(new Event("transitionend"));
		await promise;
		expect(resolved).toBe(true);

		unregister();
		el.remove();
	});

	it("runCue against an unknown target id rejects rather than silently doing nothing", async () => {
		await expect(runCue("ghost", { applyCommandIntent: vi.fn(), executeLocalCommand: vi.fn() })).rejects.toThrow(/no cue registered/i);
	});
});
