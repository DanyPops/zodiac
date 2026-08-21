import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContributionHost, ZodiacContribution } from "@zodiac/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppletRegistry } from "./applet-registry.js";
import {
	ConfiguredIntegrationLoadError,
	MAX_CONFIGURED_INTEGRATION_PACKAGES,
	loadConfiguredIntegrationPackages,
} from "./configured-loader.js";

const host: ContributionHost = { registerCommand: () => () => {}, registerResourceProvider: () => () => {} };
const roots: string[] = [];

function packageFixture(name: string, version: string, integrations: readonly { kind: "applet" | "editor"; entry: string }[]): string {
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
