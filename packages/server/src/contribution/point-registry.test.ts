import { APPLET_CONTRIBUTION_POINT, EDITOR_CONTRIBUTION_POINT, type ContributionProvenance, type ZodiacContribution } from "@zodiac/protocol";
import { describe, expect, it, vi } from "vitest";
import { ContributionCardinalityError, createContributionPointRegistry } from "./point-registry.js";
import { createInProcessExecutionStrategy } from "./execution-strategy.js";

interface AppletValue { readonly id: string; readonly title: string }
interface EditorValue { readonly id: string; readonly contribution: ZodiacContribution }
type PlatformPoints = { applet: AppletValue; editor: EditorValue };

const provenance: ContributionProvenance = {
	packageId: "@danypops/zodiac-lector",
	version: "1.2.3",
	source: "npm:@danypops/zodiac-lector@1.2.3",
};

function registry() {
	return createContributionPointRegistry<PlatformPoints>([APPLET_CONTRIBUTION_POINT, EDITOR_CONTRIBUTION_POINT]);
}

function contribution(id: string, options: { activate?: () => void | Promise<void>; dispose?: () => void | Promise<void> } = {}): ZodiacContribution {
	return {
		describe: () => ({ id, title: id, commands: [], resourceSchemes: [], contributionPoints: ["editor"] }),
		activate: async () => options.activate?.(),
		dispose: async () => options.dispose?.(),
	};
}

const host = { registerCommand: () => () => {}, registerResourceProvider: () => () => {} };

describe("createContributionPointRegistry", () => {
	it("stores multiple applets with immutable provenance and duplicate-id rejection", () => {
		const points = registry();
		points.register("applet", { id: "chat", title: "Chat" }, provenance);
		points.register("applet", { id: "notifications", title: "Notifications" }, provenance);
		expect(points.entries("applet").map((entry) => [entry.value.id, entry.provenance.packageId])).toEqual([
			["chat", "@danypops/zodiac-lector"],
			["notifications", "@danypops/zodiac-lector"],
		]);
		expect(() => points.register("applet", { id: "chat", title: "Other" }, provenance)).toThrow(/duplicate.*applet.*chat/i);
	});

	it("enforces zero-or-one and exactly-one maxima generically", () => {
		const points = registry();
		const first = contribution("lector");
		points.register("editor", { id: "lector", contribution: first }, provenance);
		expect(() => points.register("editor", { id: "other", contribution: contribution("other") }, provenance)).toThrow(ContributionCardinalityError);
	});

	it("validates exactly-one minima and unregisters through the returned lifecycle handle", () => {
		const points = registry();
		expect(() => points.validate()).toThrow(/editor.*exactly-one.*0/i);
		const unregister = points.register("editor", { id: "lector", contribution: contribution("lector") }, provenance);
		expect(() => points.validate()).not.toThrow();
		unregister();
		expect(points.entries("editor")).toEqual([]);
		expect(() => points.validate()).toThrow(/editor.*exactly-one.*0/i);
	});
});

describe("InProcessExecutionStrategy", () => {
	it("activates an editor through the injected host and records provenance until disposal", async () => {
		const points = registry();
		const activate = vi.fn();
		const dispose = vi.fn();
		const editor = contribution("lector", { activate, dispose });
		const strategy = createInProcessExecutionStrategy(points, host);
		const active = await strategy.activate(editor, provenance);
		expect(activate).toHaveBeenCalledOnce();
		expect(points.entries("editor")[0]?.provenance).toEqual(provenance);
		await active.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(points.entries("editor")).toEqual([]);
	});

	it("rolls registry state back when activation fails", async () => {
		const points = registry();
		const strategy = createInProcessExecutionStrategy(points, host);
		const editor = contribution("broken", { activate: () => { throw new Error("boom"); } });
		await expect(strategy.activate(editor, provenance)).rejects.toThrow("boom");
		expect(points.entries("editor")).toEqual([]);
	});

	it("disposes at most once and unregisters even when contribution disposal fails", async () => {
		const points = registry();
		const dispose = vi.fn(() => { throw new Error("dispose failed"); });
		const active = await createInProcessExecutionStrategy(points, host).activate(contribution("lector", { dispose }), provenance);
		await expect(active.dispose()).rejects.toThrow("dispose failed");
		expect(points.entries("editor")).toEqual([]);
		await expect(active.dispose()).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledOnce();
	});
});
