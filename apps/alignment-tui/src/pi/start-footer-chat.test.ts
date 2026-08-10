import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { startFooterChat } from "./start-footer-chat.js";

/**
 * Mirrors exactly what @danypops/pi-packed's real Profile extension does
 * (registerProfiles in profile.ts: a `session_start` handler that narrows
 * active tools via `pi.setActiveTools()`) -- as a self-contained inline
 * extension instead of depending on that package actually being installed
 * on whatever machine runs this test. Proves the *general* mechanism
 * (does `session_start`-triggered extension code actually take effect),
 * not this one specific extension.
 */
function narrowToReadOnlyExtension(): InlineExtension {
	return {
		name: "test-tool-narrowing",
		factory: (pi) => {
			pi.on("session_start", () => {
				pi.setActiveTools(["read"]);
			});
		},
	};
}

describe("startFooterChat", () => {
	const disposers: Array<() => void> = [];
	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
	});

	it("actually applies a session_start-triggered extension's tool narrowing (e.g. packed's own Profile mechanism) -- proves bindExtensions() is really being called, not just createAgentSession()", async () => {
		const faux = fauxProvider();
		const model = faux.getModel();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(model.provider, "test-key");

		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			noExtensions: true, // no dependency on this machine's real global ~/.pi/agent extensions
			extensionFactories: [narrowToReadOnlyExtension()],
		});
		await resourceLoader.reload();

		const chat = await startFooterChat({
			cwd: process.cwd(),
			modelRuntime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
		});
		if (!chat) throw new Error("startFooterChat unexpectedly failed");
		disposers.push(() => chat.session.dispose());

		// Without calling session.bindExtensions() after createAgentSession(),
		// session_start never fires, so the extension's own narrowing never
		// runs -- the session would still carry the full default tool set
		// (read/bash/edit/write). This is the exact real gap found this
		// session: the TUI's in-process integration constructed a session but
		// never bound extensions to it, unlike the web app's subprocess path
		// (a real `pi --mode rpc` process, whose own rpc-mode.js calls
		// bindExtensions() internally).
		expect(chat.session.getActiveToolNames()).toEqual(["read"]);
	});
});
