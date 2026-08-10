import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFooterChat } from "./start-footer-chat.js";

/**
 * Real cloud-provider env vars (OPENAI_API_KEY, ...) are commonly present on
 * a real developer machine -- confirmed on this one -- and pi's own provider
 * auth resolution reads them directly, bypassing whatever credential store a
 * test constructs. Without stubbing them out, "no other provider is authed"
 * is not actually true in this environment, and a test relying on that
 * silently stops testing what it claims to.
 */
const REAL_PROVIDER_ENV_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"];

/**
 * Mirrors a real custom-model-provider extension (see pi-mono's own
 * examples/extensions/custom-provider-anthropic/index.ts: `pi.registerProvider(...)`
 * called directly at the top of the factory, no session_start wrapper needed).
 * Registering happens as a side effect of the extension merely being
 * *activated* -- which, like every other extension effect this session has
 * had to reckon with, only happens inside bindExtensions(), not at
 * createAgentSession() construction time.
 */
function registerPreferredProviderExtension(preferred: ReturnType<typeof fauxProvider>): InlineExtension {
	return {
		name: "test-preferred-provider",
		factory: (pi) => {
			pi.registerProvider(preferred.provider);
		},
	};
}

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
	beforeEach(() => {
		for (const name of REAL_PROVIDER_ENV_VARS) vi.stubEnv(name, "");
	});
	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
		vi.unstubAllEnvs();
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

	it("re-resolves the user's configured default model after bindExtensions(), since a model from an extension-registered provider is invisible to createAgentSession()'s own internal resolution", async () => {
		// The provider actually available *before* any extension has activated --
		// analogous to a real, generically-authed provider (e.g. openai) that
		// happens to be broken/out of credits right now. createAgentSession()'s
		// own findInitialModel() can only ever see this one.
		const fauxInitial = fauxProvider({ provider: "initial", models: [{ id: "initial-model" }] });
		// The provider a real custom-provider extension would register -- e.g.
		// pi-mono's own anthropic-vertex example -- invisible until bindExtensions()
		// actually runs the extension's factory. This is what a real live run
		// against this machine's actual ~/.pi/agent/settings.json surfaced: its
		// configured default (anthropic-vertex/claude-sonnet-5) was silently
		// never used, and the session instead ran against whatever
		// createAgentSession() could see at construction time -- a provider that
		// (in the real run) turned out to have no credits left, producing an
		// opaque "(empty response)" in the Footer with no indication why.
		const fauxPreferred = fauxProvider({ provider: "preferred", models: [{ id: "preferred-model" }] });

		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(fauxInitial.provider);
		await modelRuntime.setRuntimeApiKey(fauxInitial.getModel().provider, "test-key");

		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			noExtensions: true,
			extensionFactories: [registerPreferredProviderExtension(fauxPreferred)],
		});
		await resourceLoader.reload();

		const settingsManager = SettingsManager.inMemory();
		settingsManager.setDefaultModelAndProvider(fauxPreferred.getModel().provider, fauxPreferred.getModel().id);

		const chat = await startFooterChat({
			cwd: process.cwd(),
			modelRuntime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			settingsManager,
		});
		if (!chat) throw new Error("startFooterChat unexpectedly failed");
		disposers.push(() => chat.session.dispose());

		expect(chat.session.model?.provider).toBe("preferred");
		expect(chat.session.model?.id).toBe("preferred-model");
	});
});
