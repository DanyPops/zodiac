import { createRemoteZodiacAgentSession, createZodiacAgentSession } from "@zodiac/pi";
import type { AgentSession, ExtensionUIContext, ModelRuntime, ResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createFooterChatController, type FooterChatController } from "./footer-chat-controller.js";

export interface StartFooterChatOptions {
	readonly cwd: string;
	/**
	 * Zodiac's own namespaced Pi config/extension/session/auth directory --
	 * deliberately separate from the user's personal ~/.pi/agent (see
	 * resolveZodiacAgentDir's own doc comment for why). Defaults to
	 * resolveZodiacAgentDir(); injectable so tests never touch a real
	 * directory on the machine running them.
	 */
	readonly agentDir?: string;
	/**
	 * Where seedZodiacAuthOnce copies an initial auth.json from. Defaults to
	 * the user's real ~/.pi/agent; injectable purely so tests never touch a
	 * real developer machine's actual personal credentials directory.
	 */
	readonly sourceAgentDir?: string;
	/**
	 * Where seedZodiacAuthOnce's own *migration* copies an initial auth.json
	 * from, if agentDir doesn't have one yet -- this product's own prior
	 * namespaced dir, before the Alignment -> Zodiac rename. Defaults to
	 * ~/.alignment/pi-agent; injectable for the same hermetic-test reason as
	 * sourceAgentDir.
	 */
	readonly legacyAlignmentAgentDir?: string;
	/** Injection points for hermetic tests -- every field defaults to exactly the production behavior when omitted. */
	readonly modelRuntime?: ModelRuntime;
	readonly resourceLoader?: ResourceLoader;
	readonly sessionManager?: SessionManager;
	readonly settingsManager?: SettingsManager;
	/**
	 * Routes an extension's `.custom()`/select()/confirm()/input() UI requests
	 * (e.g. pi-lector's `/editor`) to Zodiac's own mounted-Component facade
	 * (see createZodiacExtensionUIContext) instead of pi-coding-agent's own
	 * default `noOpUIContext`, which silently drops every such request. Built
	 * from a real SemanticShellApplication in cli.ts, constructed *before* this
	 * function runs -- see ZodiacExtensionUIContextHost's own doc comment
	 * for why that ordering is unavoidable. Absent means extensions requesting
	 * interactive UI silently no-op, exactly like today.
	 */
	readonly uiContext?: ExtensionUIContext;
	/**
	 * A real, already-running zodiacd instance to attach an agent session on
	 * instead of constructing one in-process (zodiacd stage 5). When given,
	 * every other Pi-SDK-construction option above (modelRuntime,
	 * resourceLoader, sessionManager, settingsManager, uiContext) is ignored --
	 * they all only make sense for the local, in-process path, since a remote
	 * session's own model/extensions/settings live inside zodiacd's own
	 * process, not this one.
	 */
	readonly daemonUrl?: string;
}

export interface StartedFooterChat {
	readonly footerChat: FooterChatController;
	/**
	 * The underlying real, in-process AgentSession -- only present in local
	 * mode (no daemonUrl given). Attaching to a remote zodiacd has no local
	 * AgentSession object to expose (the real one lives inside the daemon's
	 * own process) -- call `dispose()` for cleanup in *either* mode instead of
	 * reaching for `session.dispose()` directly.
	 */
	readonly session?: AgentSession;
	/** Releases this chat's own resources: session.dispose() locally, or closing the remote HTTP+SSE connection when attached to a daemon. Always safe to call, regardless of mode. */
	readonly dispose: () => void;
}

/**
 * The TUI's own thin wrapper around @zodiac/pi's createZodiacAgentSession
 * (mode: "tui") -- the actual construction (createAgentSession, auth
 * seeding, extension binding, preferred-model re-resolution) lives there
 * now, shared with apps/service's daemon-side agent sessions, so this file
 * only adds what's genuinely TUI-specific: catching construction failure
 * as "Footer stays unavailable" (exactly like today's LectorHost activation
 * failure path) instead of propagating it, and wrapping the resulting port
 * in a FooterChatController.
 *
 * When `options.daemonUrl` is given, attaches to a real, already-running
 * zodiacd's own agent session instead (createRemoteZodiacAgentSession) --
 * the exact same FooterChatController either way, since both paths only
 * ever hand it an AgentIntegrationPort, never a concrete adapter.
 */
export async function startFooterChat(options: StartFooterChatOptions): Promise<StartedFooterChat | undefined> {
	try {
		if (options.daemonUrl) {
			const { integration } = await createRemoteZodiacAgentSession({ baseUrl: options.daemonUrl, cwd: options.cwd });
			const footerChat = createFooterChatController(integration);
			return { footerChat, dispose: () => integration.dispose() };
		}
		const { session, integration } = await createZodiacAgentSession({ ...options, mode: "tui" });
		const footerChat = createFooterChatController(integration);
		return { footerChat, session, dispose: () => session.dispose() };
	} catch {
		return undefined;
	}
}
