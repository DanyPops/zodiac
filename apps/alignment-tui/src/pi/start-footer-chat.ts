import { createInProcessAgentIntegration } from "@alignment/pi-integration";
import {
	createAgentSession,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { createFooterChatController, type FooterChatController } from "./footer-chat-controller.js";

export interface StartFooterChatOptions {
	readonly cwd: string;
	/** Injection points for hermetic tests -- every field defaults to exactly the production behavior when omitted. */
	readonly modelRuntime?: ModelRuntime;
	readonly resourceLoader?: ResourceLoader;
	readonly sessionManager?: SessionManager;
	readonly settingsManager?: SettingsManager;
}

/**
 * Constructs a real, live Pi conversation via @earendil-works/pi-coding-agent's
 * public SDK (createAgentSession) -- the "proper" in-process path, not a
 * subprocess. Uses the user's real model/auth configuration (ModelRuntime.create()
 * reads ~/.pi/agent/auth.json) and real settings/extensions (SettingsManager.create(),
 * DefaultResourceLoader via createAgentSession's own defaults) for full parity
 * with a real `pi` session -- but an in-memory SessionManager, so opening
 * Alignment's TUI never writes a new session file to ~/.pi/agent/sessions/ as a
 * side effect. Failure (no model configured, no network, ...) is not fatal to
 * the rest of Alignment booting -- the Footer just stays "unavailable", exactly
 * like today's LectorHost activation failure path.
 */
export async function startFooterChat(options: StartFooterChatOptions): Promise<{ footerChat: FooterChatController; session: AgentSession } | undefined> {
	try {
		const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ signal: AbortSignal.timeout(5_000) }));
		const settingsManager = options.settingsManager ?? SettingsManager.create(options.cwd);
		const { session } = await createAgentSession({
			cwd: options.cwd,
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
		await session.bindExtensions({ mode: "tui" });
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
