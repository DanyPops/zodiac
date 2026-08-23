import { createHttpConversationClient, type ConversationClient } from "../conversation/client.js";
import { createHttpPiClient, type PiClient } from "../pi/client.js";
import { createHttpTerminalClient, type TerminalClient } from "../terminal/terminal-client.js";

/**
 * The one topology every zodiacd-backed client in this app shares: the
 * daemon's own base URL, plus the three HTTP/SSE/WebSocket clients built
 * from it. Constructed exactly once, at host bootstrap (Web's `main.tsx`
 * today; a future `apps/desktop` composition root the same way), and
 * threaded down through `RuntimeClientBundleProvider` -- never rebuilt at
 * module-evaluation time and never a per-file singleton. A test builds its
 * own bundle from fakes instead of this factory, or bypasses it entirely by
 * passing an explicit client prop where a component still accepts one
 * directly (e.g. `TerminalSurfaceContent`'s own `client` override).
 */
export interface RuntimeClientBundle {
	readonly zodiacdBaseUrl: string;
	readonly conversationClient: ConversationClient;
	readonly piClient: PiClient;
	readonly terminalClient: TerminalClient;
}

/** The only place `createHttp*Client` is called for production use -- everything else receives an already-built bundle. */
export function createRuntimeClientBundle(zodiacdBaseUrl: string): RuntimeClientBundle {
	return {
		zodiacdBaseUrl,
		conversationClient: createHttpConversationClient({ baseUrl: zodiacdBaseUrl }),
		piClient: createHttpPiClient({ baseUrl: zodiacdBaseUrl }),
		terminalClient: createHttpTerminalClient({ baseUrl: zodiacdBaseUrl }),
	};
}
