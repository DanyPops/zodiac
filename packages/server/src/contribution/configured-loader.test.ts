import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContributionHost, ZodiacContribution } from "@zodiac/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppletRegistry } from "./applet-registry.js";
import {
	ConfiguredIntegrationLoadError,
	MAX_CONFIGURED_INTEGRATION_PACKAGES,
	loadConfiguredIntegrationPackages,
	vehicleSurfaceDefinitionsFrom,
} from "./configured-loader.js";

const host: ContributionHost = { registerCommand: () => () => {}, registerResourceProvider: () => () => {} };
const roots: string[] = [];

type IntegrationFixtureEntry = { kind: "applet" | "editor"; entry: string } | { kind: "vehicle-surface"; vehicleName: string; title: string; invalidationTopics?: readonly string[] };

function packageFixture(name: string, version: string, integrations: readonly IntegrationFixtureEntry[]): string {
	const root = mkdtempSync(join(tmpdir(), "zodiac-integration-"));
	roots.push(root);
	mkdirSync(join(root, "dist"), { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ name, version, zodiac: { integrations } }));
	return root;
}

function editor(id: string, activate = vi.fn(), dispose = vi.fn()): ZodiacContribution {
	return {
		describe: () => ({ id, title: id, commands: [], resourceSchemes: [], contributionPoints: ["editor"] }),
		activate,
		dispose,
	};
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loadConfiguredIntegrationPackages", () => {
	it("discovers Lector and Papyrus fixtures in explicit order, validates them, records provenance, activates, and disposes", async () => {
		const lectorRoot = packageFixture("@danypops/zodiac-lector", "1.2.3", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const papyrusRoot = packageFixture("@danypops/zodiac-papyrus", "2.0.0", [{ kind: "applet", entry: "./dist/applet.js" }]);
		const activate = vi.fn();
		const dispose = vi.fn();
		const modules = new Map<string, Record<string, unknown>>([
			[join(lectorRoot, "dist/editor.js"), { default: editor("lector", activate, dispose) }],
			[join(papyrusRoot, "dist/applet.js"), { default: { id: "papyrus", title: "Papyrus", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 } }],
		]);
		const applets = createAppletRegistry();
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(lectorRoot, "package.json"), join(papyrusRoot, "package.json")],
			applets,
			host,
			loadModule: async (path) => modules.get(path) ?? {},
		});

		expect(loaded.integrations.map((entry) => `${entry.provenance.packageId}:${entry.kind}:${entry.id}`)).toEqual([
			"@danypops/zodiac-lector:editor:lector",
			"@danypops/zodiac-papyrus:applet:papyrus",
		]);
		expect(activate).toHaveBeenCalledOnce();
		expect(applets.registrations()[0]?.provenance).toEqual({
			packageId: "@danypops/zodiac-papyrus",
			version: "2.0.0",
			source: `path:${join(papyrusRoot, "package.json")}`,
		});

		await loaded.dispose();
		expect(dispose).toHaveBeenCalledOnce();
		expect(applets.applets()).toEqual([]);
		await loaded.dispose();
		expect(dispose).toHaveBeenCalledOnce();
	});

	// Regression for task 09bcc382 ("Wire Jittor as Zodiac's canonical live
	// token/cost/context meter"): a declarative vehicle-surface entry needs
	// no module load/activation at all -- it's pure naming data for
	// zodiacd's own VehicleSurfaceGateway.
	it("loads a declarative vehicle-surface entry with no module load, no ContributionHost registration, and no loadModule call for it", async () => {
		const jittorRoot = packageFixture("@danypops/jittor", "1.0.0", [{ kind: "vehicle-surface", vehicleName: "jittor", title: "Jittor", invalidationTopics: ["usage"] }]);
		const applets = createAppletRegistry();
		const loadModule = vi.fn(async () => ({}));
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(jittorRoot, "package.json")],
			applets,
			host,
			loadModule,
		});

		expect(loaded.integrations).toEqual([
			{
				kind: "vehicle-surface",
				id: "jittor",
				vehicleName: "jittor",
				invalidationTopics: ["usage"],
				description: { id: "jittor", title: "Jittor", commands: [], resourceSchemes: [] },
				provenance: { packageId: "@danypops/jittor", version: "1.0.0", source: `path:${join(jittorRoot, "package.json")}` },
			},
		]);
		expect(loadModule).not.toHaveBeenCalled();
		expect(vehicleSurfaceDefinitionsFrom(loaded.integrations)).toEqual([{ id: "jittor", title: "Jittor", vehicleName: "jittor", invalidationTopics: ["usage"] }]);

		// Declarative -- dispose() is a real no-op for it, not an error.
		await loaded.dispose();
	});

	it("a mix of loadable and declarative vehicle-surface entries load together, in order", async () => {
		const lectorRoot = packageFixture("@danypops/zodiac-lector", "1.2.3", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const jittorRoot = packageFixture("@danypops/jittor", "1.0.0", [{ kind: "vehicle-surface", vehicleName: "jittor", title: "Jittor" }]);
		const modules = new Map<string, Record<string, unknown>>([[join(lectorRoot, "dist/editor.js"), { default: editor("lector") }]]);
		const applets = createAppletRegistry();
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(lectorRoot, "package.json"), join(jittorRoot, "package.json")],
			applets,
			host,
			loadModule: async (path) => modules.get(path) ?? {},
		});
		expect(loaded.integrations.map((entry) => `${entry.provenance.packageId}:${entry.kind}:${entry.id}`)).toEqual([
			"@danypops/zodiac-lector:editor:lector",
			"@danypops/jittor:vehicle-surface:jittor",
		]);
		await loaded.dispose();
	});

	it("rejects configured-package and manifest bounds before loading code", async () => {
		const applets = createAppletRegistry();
		await expect(loadConfiguredIntegrationPackages({
			packageJsonPaths: Array.from({ length: MAX_CONFIGURED_INTEGRATION_PACKAGES + 1 }, (_, index) => `/tmp/${index}/package.json`),
			applets,
			host,
			loadModule: vi.fn(),
		})).rejects.toMatchObject({ code: "package-bound-exceeded" });
	});

	it("rejects traversal, malformed exports, and duplicate configured package identities with typed diagnostics", async () => {
		const traversalRoot = packageFixture("@acme/traversal", "1.0.0", [{ kind: "applet", entry: "../outside.js" }]);
		await expect(loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(traversalRoot, "package.json")], applets: createAppletRegistry(), host, loadModule: vi.fn(),
		})).rejects.toMatchObject({ code: "entry-outside-package", packageId: "@acme/traversal" });

		const malformedRoot = packageFixture("@acme/malformed", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		await expect(loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(malformedRoot, "package.json")], applets: createAppletRegistry(), host, loadModule: async () => ({ default: {} }),
		})).rejects.toMatchObject({ code: "invalid-editor-export", packageId: "@acme/malformed" });

		const duplicateRoot = packageFixture("@acme/duplicate", "1.0.0", [{ kind: "applet", entry: "./dist/applet.js" }]);
		await expect(loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(duplicateRoot, "package.json"), join(duplicateRoot, "package.json")], applets: createAppletRegistry(), host, loadModule: async () => ({}),
		})).rejects.toBeInstanceOf(ConfiguredIntegrationLoadError);
	});

	it("rolls back earlier package activation when a later contribution violates editor cardinality", async () => {
		const firstRoot = packageFixture("@acme/first", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const secondRoot = packageFixture("@acme/second", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const firstDispose = vi.fn();
		const modules = new Map<string, Record<string, unknown>>([
			[join(firstRoot, "dist/editor.js"), { default: editor("first", vi.fn(), firstDispose) }],
			[join(secondRoot, "dist/editor.js"), { default: editor("second") }],
		]);
		await expect(loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(firstRoot, "package.json"), join(secondRoot, "package.json")],
			applets: createAppletRegistry(),
			host,
			loadModule: async (path) => modules.get(path) ?? {},
		})).rejects.toMatchObject({ code: "activation-failed", packageId: "@acme/second" });
		expect(firstDispose).toHaveBeenCalledOnce();
	});
});

describe("loadConfiguredIntegrationPackages -- reload", () => {
	it("swaps an editor contribution's fresh module in transactionally: old disposed only after new activates", async () => {
		const root = packageFixture("@acme/hot", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const path = join(root, "dist/editor.js");
		const oldDispose = vi.fn();
		const newActivate = vi.fn();
		const modules = new Map<string, Record<string, unknown>>([[path, { default: editor("hot", vi.fn(), oldDispose) }]]);
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host,
			loadModule: async (p) => modules.get(p) ?? {},
		});

		modules.set(path, { default: editor("hot", newActivate, vi.fn()) });
		const result = await loaded.reload("@acme/hot");

		expect(result).toEqual({ succeeded: ["@acme/hot"], failed: [] });
		expect(oldDispose).toHaveBeenCalledOnce();
		expect(newActivate).toHaveBeenCalledOnce();
		await loaded.dispose();
	});

	it("a broken update leaves the old instance fully intact and running -- no half-swapped state", async () => {
		const root = packageFixture("@acme/hot", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const path = join(root, "dist/editor.js");
		const oldDispose = vi.fn();
		const oldActive = editor("hot", vi.fn(), oldDispose);
		const modules = new Map<string, Record<string, unknown>>([[path, { default: oldActive }]]);
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host,
			loadModule: async (p) => modules.get(p) ?? {},
		});

		// Simulate a syntax-error-shaped bad update: entry now exports nothing valid.
		modules.set(path, { default: {} });
		const result = await loaded.reload("@acme/hot");

		expect(result.succeeded).toEqual([]);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0]).toMatchObject({ packageId: "@acme/hot" });
		expect(oldDispose).not.toHaveBeenCalled();
		await loaded.dispose();
		expect(oldDispose).toHaveBeenCalledOnce();
	});

	it("cascades a reload into every other configured package that declares dependsOn against the changed package", async () => {
		// EDITOR_CONTRIBUTION_POINT is a global "exactly-one" -- two
		// editor entries cannot coexist, so the downstream package here
		// uses "vehicle-loopback" (zero-or-many) with an injected fake
		// strategy instead of a second real spawn, to isolate this test to
		// the cascade mechanic itself rather than re-exercising real
		// subprocess spawning (already covered by
		// vehicle-loopback-execution-strategy.test.ts).
		const upstreamRoot = packageFixture("@acme/upstream", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const downstreamRoot = mkdtempSync(join(tmpdir(), "zodiac-integration-"));
		roots.push(downstreamRoot);
		mkdirSync(join(downstreamRoot, "dist"), { recursive: true });
		writeFileSync(join(downstreamRoot, "package.json"), JSON.stringify({ name: "@acme/downstream", version: "1.0.0", zodiac: { integrations: [{ kind: "vehicle-loopback", vehicleName: "downstream", title: "Downstream", command: "bun", entry: "./dist/entry.js" }], dependsOn: ["@acme/upstream"] } }));

		const upstreamPath = join(upstreamRoot, "dist/editor.js");
		const modules = new Map<string, Record<string, unknown>>([[upstreamPath, { default: editor("upstream") }]]);
		const downstreamActivate = vi.fn(async () => ({ id: "downstream", description: { id: "downstream", title: "Downstream", commands: [], resourceSchemes: [] }, provenance: { packageId: "@acme/downstream", version: "1.0.0", source: "test" }, dispose: vi.fn() }));
		const fakeVehicleLoopbackStrategy = { activate: downstreamActivate };
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(upstreamRoot, "package.json"), join(downstreamRoot, "package.json")],
			applets: createAppletRegistry(), host,
			loadModule: async (p) => modules.get(p) ?? {},
			vehicleLoopbackStrategy: fakeVehicleLoopbackStrategy,
		});

		modules.set(upstreamPath, { default: editor("upstream") });
		const result = await loaded.reload("@acme/upstream");

		expect(result.succeeded).toEqual(["@acme/upstream", "@acme/downstream"]);
		expect(result.failed).toEqual([]);
		expect(downstreamActivate).toHaveBeenCalledTimes(2); // once at initial load, once on cascade
		await loaded.dispose();
	});

	it("reloading an unknown package id returns a typed failure rather than throwing", async () => {
		const root = packageFixture("@acme/hot", "1.0.0", [{ kind: "editor", entry: "./dist/editor.js" }]);
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host,
			loadModule: async () => ({ default: editor("hot") }),
		});
		const result = await loaded.reload("@acme/does-not-exist");
		expect(result.succeeded).toEqual([]);
		expect(result.failed).toEqual([{ packageId: "@acme/does-not-exist", error: expect.objectContaining({ code: "unknown-package" }) }]);
		await loaded.dispose();
	});

	// Uses the real default loadModule (no injected fixture) against real
	// files on disk -- proves defaultLoadModule's own cache-busting import
	// actually defeats Node's ESM module cache, not just the test
	// fixture's own in-memory Map lookup every other test here relies on.
	it("a real on-disk file change is genuinely re-evaluated on reload -- proves defaultLoadModule defeats Node's ESM cache", async () => {
		const root = mkdtempSync(join(tmpdir(), "zodiac-integration-"));
		roots.push(root);
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@acme/real-fs", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./dist/editor.mjs" }] } }));
		const entryPath = join(root, "dist/editor.mjs");
		writeFileSync(entryPath, "export default { describe: () => ({ id: 'real-fs', title: 'v1', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");

		const loaded = await loadConfiguredIntegrationPackages({ packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host });
		expect(loaded.integrations[0]?.description?.title).toBe("v1");

		writeFileSync(entryPath, "export default { describe: () => ({ id: 'real-fs', title: 'v2', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");
		const result = await loaded.reload("@acme/real-fs");

		expect(result).toEqual({ succeeded: ["@acme/real-fs"], failed: [] });
		expect(loaded.integrations[0]?.description?.title).toBe("v2");
		await loaded.dispose();
	});

	it("checkForChanges detects a real on-disk edit and reloads exactly the changed package, leaving an untouched one alone", async () => {
		const changedRoot = mkdtempSync(join(tmpdir(), "zodiac-integration-"));
		roots.push(changedRoot);
		mkdirSync(join(changedRoot, "dist"), { recursive: true });
		writeFileSync(join(changedRoot, "package.json"), JSON.stringify({ name: "@acme/changed", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./dist/editor.mjs" }] } }));
		const changedEntryPath = join(changedRoot, "dist/editor.mjs");
		writeFileSync(changedEntryPath, "export default { describe: () => ({ id: 'changed', title: 'v1', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");

		const untouchedRoot = packageFixture("@acme/untouched", "1.0.0", [{ kind: "applet", entry: "./dist/applet.js" }]);
		writeFileSync(join(untouchedRoot, "dist/applet.js"), "");

		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(changedRoot, "package.json"), join(untouchedRoot, "package.json")],
			applets: createAppletRegistry(), host,
			loadModule: async (p) => (p === changedEntryPath ? await import(pathToFileURL(changedEntryPath).href + `?t=${Date.now()}-${Math.random()}`) : { default: { id: "untouched", title: "Untouched", slot: "body", supportedFormFactors: new Set(["horizontal"]), maxInstances: 1 } }),
		});

		expect(await loaded.checkForChanges()).toEqual({ succeeded: [], failed: [] }); // nothing changed yet

		await new Promise((resolve) => setTimeout(resolve, 5)); // ensure a distinct mtime on filesystems with coarse timestamp resolution
		writeFileSync(changedEntryPath, "export default { describe: () => ({ id: 'changed', title: 'v2', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");
		const result = await loaded.checkForChanges();

		expect(result).toEqual({ succeeded: ["@acme/changed"], failed: [] });
		expect(loaded.integrations.find((entry) => entry.provenance.packageId === "@acme/changed")?.description?.title).toBe("v2");
		expect(loaded.integrations.find((entry) => entry.provenance.packageId === "@acme/untouched")?.id).toBe("untouched");
		await loaded.dispose();
	});

	// Regression: EDITOR_CONTRIBUTION_POINT's own exactly-one cardinality
	// makes an overlapping reload of the same package a real correctness
	// hazard (confirmed live against a real spawned zodiacd under a fast
	// poll interval: two concurrent reloads raced to dispose/re-register
	// the one active instance and could leave the editor point empty).
	it("serializes overlapping reload calls against the same package rather than racing them", async () => {
		const root = mkdtempSync(join(tmpdir(), "zodiac-integration-"));
		roots.push(root);
		mkdirSync(join(root, "dist"), { recursive: true });
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@acme/race", version: "1.0.0", zodiac: { integrations: [{ kind: "editor", entry: "./dist/editor.mjs" }] } }));
		const entryPath = join(root, "dist/editor.mjs");
		writeFileSync(entryPath, "export default { describe: () => ({ id: 'race', title: 'v1', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");

		const loaded = await loadConfiguredIntegrationPackages({ packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host });
		writeFileSync(entryPath, "export default { describe: () => ({ id: 'race', title: 'v2', commands: [], resourceSchemes: [], contributionPoints: ['editor'] }), activate: async () => {}, dispose: async () => {} };\n");

		const [first, second] = await Promise.all([loaded.reload("@acme/race"), loaded.reload("@acme/race")]);
		expect(first).toEqual({ succeeded: ["@acme/race"], failed: [] });
		expect(second).toEqual({ succeeded: ["@acme/race"], failed: [] });
		expect(loaded.integrations[0]?.description?.title).toBe("v2");
		await loaded.dispose();
	});

	it("declarative vehicle-surface and applet entries are not reload participants -- reload on them is a typed no-op success", async () => {
		const root = packageFixture("@acme/decl", "1.0.0", [{ kind: "vehicle-surface", vehicleName: "decl", title: "Decl" }]);
		const loaded = await loadConfiguredIntegrationPackages({
			packageJsonPaths: [join(root, "package.json")], applets: createAppletRegistry(), host, loadModule: vi.fn(),
		});
		expect(await loaded.reload("@acme/decl")).toEqual({ succeeded: ["@acme/decl"], failed: [] });
		await loaded.dispose();
	});
});
