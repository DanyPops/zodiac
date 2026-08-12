import { resolveAlignmentAgentDir, seedAlignmentAuthOnce } from "@alignment/server";
import { createInProcessAgentIntegration } from "@alignment/pi-integration";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ExtensionUIContext,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { createFooterChatController, type FooterChatController } from "./footer-chat-controller.js";

export interface StartFooterChatOptions {
	readonly cwd: string;
	/**
	 * Alignment's own namespaced Pi config/extension/session/auth directory --
	 * deliberately separate from the user's personal ~/.pi/agent (see
	 * resolveAlignmentAgentDir's own doc comment for why). Defaults to
	 * resolveAlignmentAgentDir(); injectable so tests never touch a real
	 * directory on the machine running them.
	 */
	readonly agentDir?: string;
	/**
	 * Where seedAlignmentAuthOnce copies an initial auth.json from. Defaults to
	 * the user's real ~/.pi/agent; injectable purely so tests never touch a
	 * real developer machine's actual personal credentials directory.
	 */
	readonly sourceAgentDir?: string;
	/** Injection points for hermetic tests -- every field defaults to exactly the production behavior when omitted. */
	readonly modelRuntime?: ModelRuntime;
	readonly resourceLoader?: ResourceLoader;
	readonly sessionManager?: SessionManager;
	readonly settingsManager?: SettingsManager;
	/**
	 * Routes an extension's `.custom()`/select()/confirm()/input() UI requests
	 * (e.g. pi-lector's `/editor`) to Alignment's own mounted-Component facade
	 * (see createAlignmentExtensionUIContext) instead of pi-coding-agent's own
	 * default `noOpUIContext`, which silently drops every such request. Built
	 * from a real SemanticShellApplication in cli.ts, constructed *before* this
	 * function runs -- see AlignmentExtensionUIContextHost's own doc comment
	 * for why that ordering is unavoidable. Absent means extensions requesting
	 * interactive UI silently no-op, exactly like today.
	 */
	readonly uiContext?: ExtensionUIContext;
}

/**
 * Constructs a real, live Pi conversation via @earendil-works/pi-coding-agent's
 * public SDK (createAgentSession) -- the "proper" in-process path, not a
 * subprocess. Uses Alignment's own namespaced agent directory (see
 * resolveAlignmentAgentDir), not the user's personal ~/.pi/agent -- so
 * Alignment's embedded session never sees whatever extensions the user has
 * personally `pkg_install`'d for their own CLI use (the concrete, real bug
 * that motivated this: an old transitive dependency of one such extension
 * emitted a Node deprecation warning inside Alignment's own process). The
 * very first time Alignment's own agent dir has no auth.json yet, one
 * credentials-only copy from the user's real ~/.pi/agent/auth.json seeds it
 * (seedAlignmentAuthOnce), so this doesn't silently lose access to
 * already-configured model credentials -- settings.json/extensions/sessions
 * are deliberately never copied. An in-memory SessionManager on top of that,
 * so opening Alignment's TUI never writes a new session file as a side
 * effect. Failure (no model configured, no network, ...) is not fatal to
 * the rest of Alignment booting -- the Footer just stays "unavailable", exactly
 * like today's LectorHost activation failure path.
 */
export async function startFooterChat(options: StartFooterChatOptions): Promise<{ footerChat: FooterChatController; session: AgentSession } | undefined> {
	try {
		const agentDir = options.agentDir ?? resolveAlignmentAgentDir();
		// Only actually touches the filesystem in production: seedAlignmentAuthOnce
		// no-ops the instant <agentDir>/auth.json already exists, which every
		// hermetic test's own injected modelRuntime/settingsManager/resourceLoader
		// (bypassing this entirely) never reaches anyway.
		if (!options.modelRuntime) {
			seedAlignmentAuthOnce({ agentDir, sourceAgentDir: options.sourceAgentDir ?? join(homedir(), ".pi", "agent") });
		}
		const modelRuntime =
			options.modelRuntime ??
			(await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				signal: AbortSignal.timeout(5_000),
			}));
		const settingsManager = options.settingsManager ?? SettingsManager.create(options.cwd, agentDir);
		const { session } = await createAgentSession({
			cwd: options.cwd,
			agentDir,
			modelRuntime,
			resourceLoader: options.resourceLoader,
			sessionManager: options.sessionManager ?? SessionManager.inMemory(options.cwd),
			settingsManager,
		});
		// createAgentSession() alone never fires session_start -- that only
		// happens inside bindExtensions() (confirmed by reading pi-coding-agent's
		// own source: AgentSession.bindExtensions() is the sole call site of
		// `_extensionRunner.emit(sessionStartEvent)`). Without this, an
		// installed extension's own session_start-triggered logic -- most
		// concretely, @danypops/pi-packed's Profile mechanism narrowing active
		// tools per-workspace via a real pi-setup.json -- silently never runs,
		// even though its tools remain fully registered and callable. The web
		// app's subprocess integration (a real `pi --mode rpc` process) doesn't
		// have this gap: pi's own rpc-mode.js calls bindExtensions() internally
		// as part of its own bootstrap.
		await session.bindExtensions({ mode: "tui", uiContext: options.uiContext });
		// createAgentSession()'s own internal default-model resolution
		// (findInitialModel) runs *before* any extension has been activated --
		// confirmed live: a custom-provider extension's own registerProvider()
		// call (e.g. pi-mono's anthropic-vertex example) only actually executes
		// inside bindExtensions(), never at construction time. A model from such
		// a provider is therefore structurally invisible to findInitialModel(),
		// even when it's the user's own explicitly configured default in
		// settings.json -- the session silently runs against whatever provider
		// *was* already known instead (which, on a real run against this
		// machine's real settings, turned out to be a provider with no credits
		// left, surfacing only as an opaque "(empty response)" with no
		// indication why). Once bindExtensions() has run, re-resolve the
		// configured default by name and switch to it if it's now available and
		// different from what was already picked -- session.setModel() itself
		// validates auth and throws if it isn't, so a still-unavailable default
		// safely leaves the already-working fallback model in place.
		//
		// This *requires* dist/cli.js's own build to keep @earendil-works/* out of
		// the esbuild bundle (see package.json's build script's --external flag).
		// A dynamically-loaded extension (e.g. @twogiants/pi-anthropic-vertex,
		// loaded from ~/.pi/agent/npm/node_modules/... at runtime, entirely
		// outside this build) resolves its own separate, unbundled copy of
		// @earendil-works/pi-ai regardless -- if cli.js also bundles its own
		// separate copy instead of resolving the same real installed one, the
		// two end up as different module instances entirely, and a provider
		// registered against one is invisible to the other. Confirmed live: this
		// exact preferredModel lookup silently returned undefined only in the
		// bundled build, never when run unbundled.
		const preferredProvider = settingsManager.getDefaultProvider();
		const preferredModelId = settingsManager.getDefaultModel();
		if (preferredProvider && preferredModelId) {
			const preferredModel = modelRuntime.getModel(preferredProvider, preferredModelId);
			if (preferredModel && preferredModel.id !== session.model?.id) {
				await session.setModel(preferredModel).catch(() => {
					/* not actually authed yet (e.g. extension needs its own /login) -- keep the already-working model */
				});
			}
		}
		const integration = createInProcessAgentIntegration(session);
		const footerChat = createFooterChatController(integration);
		return { footerChat, session };
	} catch {
		return undefined;
	}
}
