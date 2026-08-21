import { homedir } from "node:os";
import { join } from "node:path";
import { resolveZodiacAgentDir, seedZodiacAuthOnce } from "@zodiac/server/pi-agent-dir";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionUIContext,
	type ResourceLoader,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

// ExtensionMode itself isn't exported from this package's public root (only
// from an internal subpath) -- this local union mirrors its real values
// exactly (confirmed against node_modules/@earendil-works/pi-coding-agent's
// own .d.ts) and is structurally assignable to bindExtensions()'s own
// `mode?: ExtensionMode` parameter.
export type ZodiacAgentSessionMode = "tui" | "rpc" | "json" | "print";
import type { AgentIntegrationPort } from "@zodiac/agent";
import { createInProcessAgentIntegration } from "./in-process-agent-integration.js";

export interface CreateZodiacAgentSessionOptions {
	readonly cwd: string;
	/**
	 * Which caller is binding extensions -- "tui" for a real interactive
	 * terminal session, "rpc" for a headless one (a daemon session with no
	 * interactive UI, the same character pi's own `pi --mode rpc` subprocess
	 * has). Threaded straight through to AgentSession.bindExtensions().
	 */
	readonly mode: ZodiacAgentSessionMode;
	readonly agentDir?: string;
	readonly sourceAgentDir?: string;
	readonly modelRuntime?: ModelRuntime;
	readonly resourceLoader?: ResourceLoader;
	readonly sessionManager?: SessionManager;
	readonly settingsManager?: SettingsManager;
	readonly uiContext?: ExtensionUIContext;
	/** Active-tool allowlist, e.g. a Workspace's own tool grant; `[]` for zero docked Integrations. Maps to Pi's own `tools` option. Omitted keeps Pi's default (read/bash/edit/write). A caller registering customTools must include their names here too -- an empty allowlist excludes them exactly like a built-in. */
	readonly initialActiveToolNames?: readonly string[];
	/** SDK-registered tools beyond Pi's own built-ins, e.g. zodiac_dispatch_command. Maps straight to Pi's own `customTools` option. */
	readonly customTools?: readonly ToolDefinition[];
}

export interface ZodiacAgentSession {
	readonly session: AgentSession;
	readonly integration: AgentIntegrationPort;
}

/**
 * Constructs a real, live Pi conversation via @earendil-works/pi-coding-agent's
 * public SDK (createAgentSession), namespaced to Zodiac's own agent directory
 * (see resolveZodiacAgentDir) -- the one place this construction happens, so
 * a second caller (originally apps/terminal's startFooterChat, now also
 * apps/service's daemon-side agent sessions) never has to reimplement it as
 * its own bespoke copy. That exact drift (a second, divergent implementation
 * of "run an agent" appearing instead of reusing this package's own port) is
 * the concrete failure this extraction exists to prevent -- see the "Zodiac
 * state architecture" Papyrus Doc's own account of apps/web's original
 * process-rpc-session.ts never being migrated onto SubprocessAgentIntegration
 * after that adapter was built.
 *
 * Failure (no model configured, no network, ...) propagates as a thrown
 * error -- each caller decides what "unavailable" means for its own UI.
 */
export async function createZodiacAgentSession(options: CreateZodiacAgentSessionOptions): Promise<ZodiacAgentSession> {
	const agentDir = options.agentDir ?? resolveZodiacAgentDir();
	// Only actually touches the filesystem in production: seedZodiacAuthOnce
	// no-ops the instant <agentDir>/auth.json already exists, which every
	// hermetic test's own injected modelRuntime/settingsManager/resourceLoader
	// (bypassing this entirely) never reaches anyway.
	if (!options.modelRuntime) {
		seedZodiacAuthOnce({ agentDir, sourceAgentDir: options.sourceAgentDir ?? join(homedir(), ".pi", "agent") });
	}
	const modelRuntime =
		options.modelRuntime ??
		(await ModelRuntime.create({
			authPath: join(agentDir, "auth.json"),
			modelsPath: join(agentDir, "models.json"),
			signal: AbortSignal.timeout(5_000),
		}));
	async function createBoundSession(sessionManager: SessionManager): Promise<AgentSession> {
		const cwd = sessionManager.getCwd() || options.cwd;
		const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			modelRuntime,
			resourceLoader: options.resourceLoader,
			sessionManager,
			settingsManager,
			...(options.initialActiveToolNames !== undefined ? { tools: [...options.initialActiveToolNames] } : {}),
			...(options.customTools !== undefined ? { customTools: [...options.customTools] } : {}),
		});
		// createAgentSession() alone never fires session_start -- that only
		// happens inside bindExtensions(). Replacements must bind exactly like
		// the initial session or installed extension/profile behavior silently
		// disappears after resume/fork.
		await session.bindExtensions({ mode: options.mode, uiContext: options.uiContext });
		// Re-resolve an extension-provided preferred model after extensions bind;
		// createAgentSession's initial resolution necessarily runs before then.
		const preferredProvider = settingsManager.getDefaultProvider();
		const preferredModelId = settingsManager.getDefaultModel();
		if (preferredProvider && preferredModelId) {
			const preferredModel = modelRuntime.getModel(preferredProvider, preferredModelId);
			if (preferredModel && preferredModel.id !== session.model?.id) {
				await session.setModel(preferredModel).catch(() => {
					/* not actually authed yet -- keep the already-working fallback */
				});
			}
		}
		return session;
	}

	// Zodiac-owned sessions persist under Zodiac's own namespaced agentDir,
	// never the user's generic Pi session store. Persistence is what makes the
	// shared resume/fork control contract real in the embedded zodiacd host.
	const initialSessionManager = options.sessionManager ?? SessionManager.create(options.cwd, join(agentDir, "sessions"));
	let activeSession = await createBoundSession(initialSessionManager);
	const integration = createInProcessAgentIntegration(activeSession, {
		resolveModel: (provider, modelId) => modelRuntime.getModel(provider, modelId),
		resumeSession: async (sessionPath) => {
			activeSession = await createBoundSession(SessionManager.open(sessionPath));
			return activeSession;
		},
		forkSession: async (session, entryId) => {
			const sessionPath = session.sessionManager.createBranchedSession(entryId);
			if (!sessionPath) return undefined;
			activeSession = await createBoundSession(SessionManager.open(sessionPath));
			return activeSession;
		},
	});
	return {
		get session() {
			return activeSession;
		},
		integration,
	};
}
