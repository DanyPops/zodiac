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
		const { session } = await createAgentSession({
			cwd: options.cwd,
			modelRuntime,
			resourceLoader: options.resourceLoader,
			sessionManager: options.sessionManager ?? SessionManager.inMemory(options.cwd),
			settingsManager: options.settingsManager ?? SettingsManager.create(options.cwd),
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
		const integration = createInProcessAgentIntegration(session);
		const footerChat = createFooterChatController(integration);
		return { footerChat, session };
	} catch {
		return undefined;
	}
}
