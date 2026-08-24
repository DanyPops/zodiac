import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AppletDefinitionSchema,
	EDITOR_CONTRIBUTION_POINT,
	type ContributionDescription,
	type ContributionHost,
	type ContributionPointKind,
	type ContributionProvenance,
	type ZodiacContribution,
} from "@zodiac/protocol";
import { z } from "zod";
import type { AppletRegistry } from "./applet-registry.js";
import { createInProcessExecutionStrategy, type ActiveContribution, type EditorContributionRegistration } from "./execution-strategy.js";
import { createContributionPointRegistry } from "./point-registry.js";
import { readZodiacManifest, type ZodiacManifestField } from "./manifest.js";

export const MAX_CONFIGURED_INTEGRATION_PACKAGES = 32;
export const MAX_CONFIGURED_INTEGRATIONS = 128;
export const MAX_INTEGRATION_PACKAGE_JSON_BYTES = 128 * 1024;

const PackageJsonSchema = z.object({
	name: z.string().trim().min(1).max(214),
	version: z.string().trim().min(1).max(100),
});

export type ConfiguredIntegrationLoadErrorCode =
	| "package-bound-exceeded"
	| "integration-bound-exceeded"
	| "duplicate-package"
	| "invalid-package-json"
	| "missing-manifest"
	| "entry-outside-package"
	| "module-load-failed"
	| "invalid-applet-export"
	| "invalid-editor-export"
	| "activation-failed";

export class ConfiguredIntegrationLoadError extends Error {
	readonly code: ConfiguredIntegrationLoadErrorCode;
	readonly source: string;
	readonly packageId?: string;

	constructor(code: ConfiguredIntegrationLoadErrorCode, source: string, message: string, options: { packageId?: string; cause?: unknown } = {}) {
		super(message, { cause: options.cause });
		this.name = "ConfiguredIntegrationLoadError";
		this.code = code;
		this.source = source;
		this.packageId = options.packageId;
	}
}

export interface LoadedConfiguredIntegration {
	readonly kind: ContributionPointKind;
	readonly id: string;
	/** Absent for a declarative vehicle-surface entry -- there is no module to load. */
	readonly entry?: string;
	readonly description?: ContributionDescription;
	readonly provenance: ContributionProvenance;
	/** Present only for kind: "vehicle-surface" -- see vehicleSurfaceDefinitionsFrom. */
	readonly vehicleName?: string;
	readonly invalidationTopics?: readonly string[];
}

/**
 * Projects the vehicle-surface entries out of a load result into the exact
 * shape `createSharedVehicleSurfaceGateway`'s own `definitions` option
 * expects -- the caller (zodiacd's own cli.ts) merges these with any
 * hardcoded definitions rather than this module depending on
 * @zodiac/server's own vehicle-surface-gateway module (contribution
 * loading stays independent of that specific gateway's own shape beyond
 * this narrow projection).
 */
export function vehicleSurfaceDefinitionsFrom(integrations: readonly LoadedConfiguredIntegration[]): readonly { id: string; title: string; vehicleName: string; invalidationTopics?: readonly string[] }[] {
	return integrations
		.filter((integration) => integration.kind === "vehicle-surface" && integration.vehicleName !== undefined)
		.map((integration) => ({ id: integration.id, title: integration.description?.title ?? integration.id, vehicleName: integration.vehicleName!, invalidationTopics: integration.invalidationTopics }));
}

export interface LoadedConfiguredIntegrations {
	readonly integrations: readonly LoadedConfiguredIntegration[];
	dispose(): Promise<void>;
}

export interface LoadConfiguredIntegrationPackagesOptions {
	readonly packageJsonPaths: readonly string[];
	readonly applets: AppletRegistry;
	readonly host: ContributionHost;
	readonly loadModule?: (absolutePath: string) => Promise<unknown>;
}

interface PackageConfig {
	readonly packageJsonPath: string;
	readonly root: string;
	readonly manifest: ZodiacManifestField;
	readonly provenance: ContributionProvenance;
}

function readPackageConfig(packageJsonPath: string): PackageConfig {
	let canonical: string;
	let raw: unknown;
	try {
		canonical = realpathSync(packageJsonPath);
		const size = statSync(canonical).size;
		if (size > MAX_INTEGRATION_PACKAGE_JSON_BYTES) {
			throw new ConfiguredIntegrationLoadError("invalid-package-json", canonical, `Integration package.json is ${size} bytes; cap is ${MAX_INTEGRATION_PACKAGE_JSON_BYTES}`);
		}
		raw = JSON.parse(readFileSync(canonical, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof ConfiguredIntegrationLoadError) throw error;
		throw new ConfiguredIntegrationLoadError("invalid-package-json", packageJsonPath, `Cannot read configured Integration package.json: ${packageJsonPath}`, { cause: error });
	}
	const identity = PackageJsonSchema.safeParse(raw);
	if (!identity.success) throw new ConfiguredIntegrationLoadError("invalid-package-json", canonical, `Configured Integration package.json must declare bounded name and version`);
	let manifest: ZodiacManifestField | undefined;
	try {
		manifest = readZodiacManifest(raw);
	} catch (error) {
		throw new ConfiguredIntegrationLoadError("invalid-package-json", canonical, `Malformed zodiac manifest in ${identity.data.name}`, { packageId: identity.data.name, cause: error });
	}
	if (!manifest) throw new ConfiguredIntegrationLoadError("missing-manifest", canonical, `Configured package ${identity.data.name} has no zodiac manifest`, { packageId: identity.data.name });
	return {
		packageJsonPath: canonical,
		root: dirname(canonical),
		manifest,
		provenance: { packageId: identity.data.name, version: identity.data.version, source: `path:${canonical}` },
	};
}

function resolveEntry(pkg: PackageConfig, entry: string): string {
	const absolute = resolve(pkg.root, entry);
	const fromRoot = relative(pkg.root, absolute);
	if (isAbsolute(entry) || fromRoot === ".." || fromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(fromRoot)) {
		throw new ConfiguredIntegrationLoadError("entry-outside-package", pkg.packageJsonPath, `Integration entry escapes package root: ${entry}`, { packageId: pkg.provenance.packageId });
	}
	return absolute;
}

function exportedValue(module: unknown): unknown {
	if (typeof module !== "object" || module === null) return undefined;
	return (module as Record<string, unknown>).default;
}

function isEditorContribution(value: unknown): value is ZodiacContribution {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<ZodiacContribution>;
	return typeof candidate.describe === "function" && typeof candidate.activate === "function" && typeof candidate.dispose === "function";
}

async function defaultLoadModule(absolutePath: string): Promise<unknown> {
	return import(pathToFileURL(absolutePath).href);
}

/** Loads only explicitly configured package.json paths; there is no ambient scan or package-name fallback. */
export async function loadConfiguredIntegrationPackages(options: LoadConfiguredIntegrationPackagesOptions): Promise<LoadedConfiguredIntegrations> {
	if (options.packageJsonPaths.length > MAX_CONFIGURED_INTEGRATION_PACKAGES) {
		throw new ConfiguredIntegrationLoadError(
			"package-bound-exceeded",
			"configuration",
			`Configured ${options.packageJsonPaths.length} Integration packages; cap is ${MAX_CONFIGURED_INTEGRATION_PACKAGES}`,
		);
	}
	const packages: PackageConfig[] = [];
	const packagePaths = new Set<string>();
	const packageIds = new Set<string>();
	let integrationCount = 0;
	for (const path of options.packageJsonPaths) {
		const pkg = readPackageConfig(path);
		if (packagePaths.has(pkg.packageJsonPath) || packageIds.has(pkg.provenance.packageId)) {
			throw new ConfiguredIntegrationLoadError("duplicate-package", pkg.packageJsonPath, `Duplicate configured Integration package: ${pkg.provenance.packageId}`, { packageId: pkg.provenance.packageId });
		}
		packagePaths.add(pkg.packageJsonPath);
		packageIds.add(pkg.provenance.packageId);
		integrationCount += pkg.manifest.integrations.length;
		if (integrationCount > MAX_CONFIGURED_INTEGRATIONS) {
			throw new ConfiguredIntegrationLoadError("integration-bound-exceeded", pkg.packageJsonPath, `Configured ${integrationCount} Integration entries; cap is ${MAX_CONFIGURED_INTEGRATIONS}`, { packageId: pkg.provenance.packageId });
		}
		packages.push(pkg);
	}

	const editorPoints = createContributionPointRegistry<{ editor: EditorContributionRegistration }>([EDITOR_CONTRIBUTION_POINT]);
	const strategy = createInProcessExecutionStrategy(editorPoints, options.host);
	const loadModule = options.loadModule ?? defaultLoadModule;
	const cleanup: Array<() => void | Promise<void>> = [];
	const loaded: LoadedConfiguredIntegration[] = [];
	let disposed = false;

	async function rollback(): Promise<void> {
		for (const dispose of cleanup.splice(0).reverse()) {
			try { await dispose(); } catch { /* Preserve the load failure that triggered rollback. */ }
		}
	}

	try {
		for (const pkg of packages) {
			for (const declared of pkg.manifest.integrations) {
				if (declared.kind === "vehicle-surface") {
					// Declarative -- no module to load, no ContributionHost
					// registration, no cleanup needed on dispose.
					loaded.push({ kind: "vehicle-surface", id: declared.vehicleName, provenance: pkg.provenance, vehicleName: declared.vehicleName, invalidationTopics: declared.invalidationTopics, description: { id: declared.vehicleName, title: declared.title, commands: [], resourceSchemes: [] } });
					continue;
				}
				const entry = resolveEntry(pkg, declared.entry);
				let module: unknown;
				try {
					module = await loadModule(entry);
				} catch (error) {
					throw new ConfiguredIntegrationLoadError("module-load-failed", entry, `Failed loading ${pkg.provenance.packageId} entry ${declared.entry}`, { packageId: pkg.provenance.packageId, cause: error });
				}
				const value = exportedValue(module);
				if (declared.kind === "applet") {
					const parsed = AppletDefinitionSchema.safeParse(value);
					if (!parsed.success) throw new ConfiguredIntegrationLoadError("invalid-applet-export", entry, `${pkg.provenance.packageId} applet entry must default-export an AppletDefinition`, { packageId: pkg.provenance.packageId, cause: parsed.error });
					try {
						cleanup.push(options.applets.registerApplet(parsed.data, pkg.provenance));
					} catch (error) {
						throw new ConfiguredIntegrationLoadError("activation-failed", entry, `Failed registering ${pkg.provenance.packageId} applet contribution`, { packageId: pkg.provenance.packageId, cause: error });
					}
					loaded.push({ kind: "applet", id: parsed.data.id, entry, provenance: pkg.provenance });
					continue;
				}
				if (!isEditorContribution(value)) throw new ConfiguredIntegrationLoadError("invalid-editor-export", entry, `${pkg.provenance.packageId} editor entry must default-export a ZodiacContribution`, { packageId: pkg.provenance.packageId });
				let active: ActiveContribution;
				try {
					active = await strategy.activate(value, pkg.provenance);
				} catch (error) {
					throw new ConfiguredIntegrationLoadError("activation-failed", entry, `Failed activating ${pkg.provenance.packageId} editor contribution`, { packageId: pkg.provenance.packageId, cause: error });
				}
				cleanup.push(() => active.dispose());
				loaded.push({ kind: "editor", id: active.id, entry, description: active.description, provenance: pkg.provenance });
			}
		}
	} catch (error) {
		await rollback();
		throw error;
	}

	return {
		integrations: loaded,
		async dispose() {
			if (disposed) return;
			disposed = true;
			let firstError: unknown;
			for (const dispose of cleanup.splice(0).reverse()) {
				try { await dispose(); } catch (error) { firstError ??= error; }
			}
			if (firstError !== undefined) throw firstError;
		},
	};
}
