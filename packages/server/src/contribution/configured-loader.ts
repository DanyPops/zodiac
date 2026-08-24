import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	AppletDefinitionSchema,
	EDITOR_CONTRIBUTION_POINT,
	VEHICLE_LOOPBACK_CONTRIBUTION_POINT,
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
import { createVehicleLoopbackExecutionStrategy } from "./vehicle-loopback-execution-strategy.js";
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
	| "activation-failed"
	| "unknown-package";

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

export interface ContributionReloadFailure {
	readonly packageId: string;
	readonly error: ConfiguredIntegrationLoadError;
}

/**
 * Never throws -- a reload's own outcome is a typed report, not an
 * exception, since a failed swap is an expected, recoverable case (the
 * prior code keeps serving) rather than a programmer error. `succeeded`
 * lists every package id that actually swapped, in cascade order (the
 * requested package first, then each dependent that named it via the
 * manifest's own `dependsOn`); `failed` lists every package id a reload
 * attempt touched but could not safely swap -- its prior instance was
 * left running untouched in every one of those cases.
 */
export interface ContributionReloadResult {
	readonly succeeded: readonly string[];
	readonly failed: readonly ContributionReloadFailure[];
}

export interface LoadedConfiguredIntegrations {
	readonly integrations: readonly LoadedConfiguredIntegration[];
	dispose(): Promise<void>;
	/**
	 * Re-reads the named package's own package.json/manifest from disk,
	 * re-imports its declared editor/vehicle-loopback entries fresh
	 * (never a stale cached module), and swaps in whichever ones
	 * activate successfully -- but only after every one of them has
	 * activated: a syntax error or invalid export in any one of a
	 * package's declared entries leaves that package's entire prior
	 * instance set running, untouched (Cordis's own Algorithm 10
	 * transactional swap: no half-swapped state, ever). A declarative
	 * "vehicle-surface"/"applet" entry has no reversible activate/
	 * dispose lifecycle to swap -- reloading a package that only
	 * declares those kinds is a typed no-op success. On success, every
	 * other configured package whose own manifest names this package
	 * in `dependsOn` is reloaded too, recursively and cycle-safely.
	 */
	reload(packageId: string): Promise<ContributionReloadResult>;
	/**
	 * The file/version change classification half of hot-reload: checks
	 * every reload-capable configured package's own declared entry
	 * file(s) for an mtime/size change since the last check (or initial
	 * load), and reloads exactly the ones that changed -- plus, via
	 * `reload`'s own cascade, every other package depending on one of
	 * them -- leaving every unchanged package's instance running
	 * undisturbed. A caller decides when to call this (a poll interval,
	 * an admin command, a real fs.watch callback); this module owns only
	 * the classification and the transactional swap, not the trigger.
	 */
	checkForChanges(): Promise<ContributionReloadResult>;
}

export interface LoadConfiguredIntegrationPackagesOptions {
	readonly packageJsonPaths: readonly string[];
	readonly applets: AppletRegistry;
	readonly host: ContributionHost;
	readonly loadModule?: (absolutePath: string) => Promise<unknown>;
	/** Injectable for tests -- production callers always get the real out-of-process strategy. */
	readonly vehicleLoopbackStrategy?: ReturnType<typeof createVehicleLoopbackExecutionStrategy>;
}

interface PackageConfig {
	readonly packageJsonPath: string;
	readonly root: string;
	readonly manifest: ZodiacManifestField;
	readonly provenance: ContributionProvenance;
}

interface VehicleLoopbackSpec {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
}

/**
 * One reload-capable entry within a configured package -- exactly the two
 * contribution kinds with a real activate/dispose lifecycle
 * (execution-strategy.ts's ActiveContribution). `active` and `cleanupHandle`
 * are mutated in place on a successful reload rather than accumulating a
 * fresh dispose closure per reload, so a package reloaded many times over a
 * long-running zodiacd process never grows the cleanup list unboundedly.
 */
type ReloadableEntry = {
	readonly index: number;
	active: ActiveContribution;
	readonly cleanupHandle: { dispose(): void | Promise<void> };
} & (
	// EDITOR_CONTRIBUTION_POINT is "exactly-one" system-wide -- a fresh
	// instance cannot be activated while the old one still holds the
	// point's single slot, so a reload here must dispose-then-activate,
	// not blue-green. `value` retains the currently-active raw
	// ZodiacContribution so a failed swap can reactivate the exact same
	// already-known-good object to restore service (Cordis's own
	// Algorithm 10: "reactivate from the backed-up prior module").
	| { readonly kind: "editor"; readonly entryPath: string; value: ZodiacContribution }
	// VEHICLE_LOOPBACK_CONTRIBUTION_POINT is "zero-or-many" -- a fresh
	// instance can activate (a second real process, briefly, alongside
	// the first) before the old one is disposed, giving a genuine
	// zero-downtime blue-green swap with no cardinality conflict.
	| { readonly kind: "vehicle-loopback"; readonly vehicleName: string; readonly title: string; readonly spec: VehicleLoopbackSpec }
);

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

interface EntrySignature {
	readonly mtimeMs: number;
	readonly size: number;
}

/**
 * A cheap, real-disk stand-in for Cordis's own import-graph module
 * classification (Algorithm 8): rather than walking an AST of import
 * statements (Zodiac's own contributions are single-entry modules, not
 * Cordis's arbitrary multi-file plugin graphs), a package's own "did
 * anything change" question reduces to "did any of its declared entry
 * files' mtime/size change since the signature was last recorded" --
 * both the entry-file classification's own default-to-declined-on-
 * ambiguity spirit (a missing/unreadable file is always treated as
 * "changed", forcing an explicit reload attempt rather than silently
 * skipping it) and the actual outcome (a real file edit is detected)
 * are preserved without needing a full import-graph walker.
 */
function computeEntrySignature(path: string): EntrySignature | null {
	try {
		const stats = statSync(path);
		return { mtimeMs: stats.mtimeMs, size: stats.size };
	} catch {
		return null;
	}
}

function signatureChanged(previous: EntrySignature | null, current: EntrySignature | null): boolean {
	if (previous === null || current === null) return true;
	return previous.mtimeMs !== current.mtimeMs || previous.size !== current.size;
}

function entryFilePath(entry: ReloadableEntry): string {
	return entry.kind === "editor" ? entry.entryPath : entry.spec.args[0]!;
}

// Node's ESM loader has no exposed cache-eviction API (unlike CJS's
// mutable require.cache) -- a bare `import(url)` for the same URL string
// always returns the previously-evaluated module, silently ignoring a real
// on-disk change. Appending a monotonically increasing, never-repeating
// query parameter forces genuinely fresh evaluation of the file's current
// content on every call (the same cache-busting technique Vite's own SSR
// module invalidation relies on for the identical reason), independent of
// whether this is the very first load or a hot-reload.
let loadCounter = 0;

async function defaultLoadModule(absolutePath: string): Promise<unknown> {
	const url = pathToFileURL(absolutePath);
	url.search = `?zodiacLoad=${Date.now()}-${(loadCounter += 1)}`;
	return import(url.href);
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
	const vehicleLoopbackPoints = createContributionPointRegistry<{ "vehicle-loopback": { readonly id: string } }>([VEHICLE_LOOPBACK_CONTRIBUTION_POINT]);
	const vehicleLoopbackStrategy = options.vehicleLoopbackStrategy ?? createVehicleLoopbackExecutionStrategy(vehicleLoopbackPoints, options.host);
	const loadModule = options.loadModule ?? defaultLoadModule;
	const cleanup: Array<() => void | Promise<void>> = [];
	const loaded: LoadedConfiguredIntegration[] = [];
	let disposed = false;

	// Reload bookkeeping -- built alongside the initial load, kept current
	// on every successful reload. packagesById holds the freshest
	// package.json/manifest read for that package; reloadableByPackage
	// tracks exactly the entries with a reversible activate/dispose
	// lifecycle (editor, vehicle-loopback) -- a declarative vehicle-surface
	// or applet entry has no such lifecycle to swap and is never tracked
	// here. dependentsOf is built once from every package's own
	// `dependsOn` declaration: reloading key K also reloads every package
	// in dependentsOf.get(K).
	const packagesById = new Map<string, PackageConfig>();
	const reloadableByPackage = new Map<string, ReloadableEntry[]>();
	const dependentsOf = new Map<string, Set<string>>();
	const signatures = new Map<ReloadableEntry, EntrySignature | null>();

	async function rollback(): Promise<void> {
		for (const dispose of cleanup.splice(0).reverse()) {
			try { await dispose(); } catch { /* Preserve the load failure that triggered rollback. */ }
		}
	}

	try {
		for (const pkg of packages) {
			packagesById.set(pkg.provenance.packageId, pkg);
			reloadableByPackage.set(pkg.provenance.packageId, []);
			for (const dependency of pkg.manifest.dependsOn) {
				let dependents = dependentsOf.get(dependency);
				if (!dependents) { dependents = new Set(); dependentsOf.set(dependency, dependents); }
				dependents.add(pkg.provenance.packageId);
			}
			for (const declared of pkg.manifest.integrations) {
				if (declared.kind === "vehicle-surface") {
					// Declarative -- no module to load, no ContributionHost
					// registration, no cleanup needed on dispose.
					loaded.push({ kind: "vehicle-surface", id: declared.vehicleName, provenance: pkg.provenance, vehicleName: declared.vehicleName, invalidationTopics: declared.invalidationTopics, description: { id: declared.vehicleName, title: declared.title, commands: [], resourceSchemes: [] } });
					continue;
				}
				if (declared.kind === "vehicle-loopback") {
					// Code-bearing, but zodiacd never imports it in-process: the
					// entry is resolved/contained exactly like an in-process
					// editor/applet entry, but spawned as a real child process
					// and connected to over an authenticated Vehicle loopback
					// (see vehicle-loopback-execution-strategy.ts).
					const entryPath = resolveEntry(pkg, declared.entry);
					const spec = { command: declared.command, args: [entryPath, ...(declared.args ?? [])], cwd: pkg.root };
					let active: ActiveContribution;
					try {
						active = await vehicleLoopbackStrategy.activate(declared.vehicleName, declared.title, spec, pkg.provenance);
					} catch (error) {
						throw new ConfiguredIntegrationLoadError("activation-failed", entryPath, `Failed activating ${pkg.provenance.packageId} vehicle-loopback contribution`, { packageId: pkg.provenance.packageId, cause: error });
					}
					const vehicleLoopbackCleanupHandle = { dispose: () => active.dispose() };
					cleanup.push(() => vehicleLoopbackCleanupHandle.dispose());
					loaded.push({ kind: "vehicle-loopback", id: active.id, entry: entryPath, description: active.description, provenance: pkg.provenance, vehicleName: declared.vehicleName });
					const vehicleLoopbackEntry: ReloadableEntry = { kind: "vehicle-loopback", index: loaded.length - 1, vehicleName: declared.vehicleName, title: declared.title, spec, active, cleanupHandle: vehicleLoopbackCleanupHandle };
					reloadableByPackage.get(pkg.provenance.packageId)!.push(vehicleLoopbackEntry);
					signatures.set(vehicleLoopbackEntry, computeEntrySignature(entryFilePath(vehicleLoopbackEntry)));
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
				const editorCleanupHandle = { dispose: () => active.dispose() };
				cleanup.push(() => editorCleanupHandle.dispose());
				loaded.push({ kind: "editor", id: active.id, entry, description: active.description, provenance: pkg.provenance });
				const editorEntry: ReloadableEntry = { kind: "editor", index: loaded.length - 1, entryPath: entry, value, active, cleanupHandle: editorCleanupHandle };
				reloadableByPackage.get(pkg.provenance.packageId)!.push(editorEntry);
				signatures.set(editorEntry, computeEntrySignature(entryFilePath(editorEntry)));
			}
		}
	} catch (error) {
		await rollback();
		throw error;
	}

	async function loadFreshEditorValue(pkg: PackageConfig, entryPath: string): Promise<ZodiacContribution> {
		let module: unknown;
		try {
			module = await loadModule(entryPath);
		} catch (error) {
			throw new ConfiguredIntegrationLoadError("module-load-failed", entryPath, `Failed reloading ${pkg.provenance.packageId} entry`, { packageId: pkg.provenance.packageId, cause: error });
		}
		const value = exportedValue(module);
		if (!isEditorContribution(value)) throw new ConfiguredIntegrationLoadError("invalid-editor-export", entryPath, `${pkg.provenance.packageId} editor entry must default-export a ZodiacContribution`, { packageId: pkg.provenance.packageId });
		return value;
	}

	/**
	 * Reloads one already-tracked entry, swapping in a fresh instance.
	 * Cardinality dictates the order: "zero-or-many" (vehicle-loopback) can
	 * activate the fresh instance before disposing the old one
	 * (zero-downtime blue-green, no conflict); "exactly-one" (editor) must
	 * free the slot first, and on a failed fresh activation, restores
	 * service by reactivating the exact same already-known-good retained
	 * value (Algorithm 10's own "reactivate from the backed-up prior
	 * module") rather than leaving the slot empty.
	 */
	async function reloadEntry(pkg: PackageConfig, entry: ReloadableEntry): Promise<{ ok: true } | { ok: false; error: ConfiguredIntegrationLoadError; restored: boolean }> {
		if (entry.kind === "vehicle-loopback") {
			let fresh: ActiveContribution;
			try {
				fresh = await vehicleLoopbackStrategy.activate(entry.vehicleName, entry.title, entry.spec, pkg.provenance);
			} catch (error) {
				return { ok: false, restored: true, error: error instanceof ConfiguredIntegrationLoadError ? error : new ConfiguredIntegrationLoadError("activation-failed", entry.spec.cwd, `Failed reloading ${pkg.provenance.packageId} vehicle-loopback contribution`, { packageId: pkg.provenance.packageId, cause: error }) };
			}
			try { await entry.active.dispose(); } catch { /* Best-effort teardown of the now-superseded instance. */ }
			entry.active = fresh;
			entry.cleanupHandle.dispose = () => fresh.dispose();
			return { ok: true };
		}
		let freshValue: ZodiacContribution;
		try {
			freshValue = await loadFreshEditorValue(pkg, entry.entryPath);
		} catch (error) {
			// Never touched the old instance -- module loading/validation
			// failed before the exactly-one slot was even freed.
			return { ok: false, restored: true, error: error as ConfiguredIntegrationLoadError };
		}
		try { await entry.active.dispose(); } catch { /* Best-effort teardown; proceed to free the exactly-one slot regardless. */ }
		try {
			const freshActive = await strategy.activate(freshValue, pkg.provenance);
			entry.value = freshValue;
			entry.active = freshActive;
			entry.cleanupHandle.dispose = () => freshActive.dispose();
			return { ok: true };
		} catch (error) {
			const activationError = error instanceof ConfiguredIntegrationLoadError ? error : new ConfiguredIntegrationLoadError("activation-failed", entry.entryPath, `Failed reloading ${pkg.provenance.packageId} editor contribution`, { packageId: pkg.provenance.packageId, cause: error });
			try {
				const restoredActive = await strategy.activate(entry.value, pkg.provenance);
				entry.active = restoredActive;
				entry.cleanupHandle.dispose = () => restoredActive.dispose();
				return { ok: false, restored: true, error: activationError };
			} catch (restoreError) {
				// Both the fresh and the prior instance failed to activate --
				// the editor point's exactly-one slot is now genuinely empty.
				// Surfaced distinctly (restored: false) rather than silently
				// reported the same as an ordinary reload failure.
				return { ok: false, restored: false, error: new ConfiguredIntegrationLoadError("activation-failed", entry.entryPath, `Reload of ${pkg.provenance.packageId} failed and restoring the prior instance also failed -- the editor contribution point is now empty`, { packageId: pkg.provenance.packageId, cause: restoreError }) };
			}
		}
	}

	async function reloadOne(packageId: string, visited: Set<string>, failures: ContributionReloadFailure[], succeeded: string[]): Promise<void> {
		if (visited.has(packageId)) return;
		visited.add(packageId);
		const pkg = packagesById.get(packageId);
		if (!pkg) {
			failures.push({ packageId, error: new ConfiguredIntegrationLoadError("unknown-package", packageId, `No configured Integration package named ${packageId}`, { packageId }) });
			return;
		}
		let freshPkg: PackageConfig;
		try {
			freshPkg = readPackageConfig(pkg.packageJsonPath);
		} catch (error) {
			failures.push({ packageId, error: error instanceof ConfiguredIntegrationLoadError ? error : new ConfiguredIntegrationLoadError("invalid-package-json", pkg.packageJsonPath, `Failed re-reading ${packageId}`, { packageId, cause: error }) });
			return;
		}
		const entries = reloadableByPackage.get(packageId) ?? [];
		for (const entry of entries) {
			const result = await reloadEntry(freshPkg, entry);
			if (!result.ok) {
				failures.push({ packageId, error: result.error });
				return;
			}
			loaded[entry.index] = { ...loaded[entry.index]!, description: entry.active.description, provenance: freshPkg.provenance };
			signatures.set(entry, computeEntrySignature(entryFilePath(entry)));
		}
		packagesById.set(packageId, freshPkg);
		succeeded.push(packageId);
		for (const dependentId of dependentsOf.get(packageId) ?? []) await reloadOne(dependentId, visited, failures, succeeded);
	}

	// Single-flight: EDITOR_CONTRIBUTION_POINT's own exactly-one cardinality
	// makes an overlapping reload of the same package a real correctness
	// hazard, not just wasted work -- two concurrent attempts both dispose
	// the one active instance and race to (re-)register the point, which
	// can leave the point doubly-registered or, worse, empty (confirmed
	// live: a fast poll interval genuinely produced overlapping ticks
	// before the first one's own state update had landed). Every reload/
	// checkForChanges call is queued onto the same chain rather than run
	// concurrently, regardless of caller (the poll loop, an admin command,
	// or a test calling both at once).
	let reloadChain: Promise<unknown> = Promise.resolve();
	function serialized<T>(work: () => Promise<T>): Promise<T> {
		const result = reloadChain.then(work, work);
		reloadChain = result.catch(() => undefined);
		return result;
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
		reload(packageId) {
			return serialized(async () => {
				const succeeded: string[] = [];
				const failed: ContributionReloadFailure[] = [];
				await reloadOne(packageId, new Set(), failed, succeeded);
				return { succeeded, failed };
			});
		},
		checkForChanges() {
			return serialized(async () => {
				const succeeded: string[] = [];
				const failed: ContributionReloadFailure[] = [];
				const visited = new Set<string>();
				for (const [packageId, entries] of reloadableByPackage) {
					if (visited.has(packageId)) continue; // already handled by an earlier package's own cascade this pass
					const changed = entries.some((entry) => signatureChanged(signatures.get(entry) ?? null, computeEntrySignature(entryFilePath(entry))));
					if (changed) await reloadOne(packageId, visited, failed, succeeded);
				}
				return { succeeded, failed };
			});
		},
	};
}
