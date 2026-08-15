import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZodiacAgentSession } from "./zodiac-agent-session.js";

const REAL_PROVIDER_ENV_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"];

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

describe("createZodiacAgentSession", () => {
	const disposers: Array<() => void> = [];
	beforeEach(() => {
		for (const name of REAL_PROVIDER_ENV_VARS) vi.stubEnv(name, "");
	});
	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
		vi.unstubAllEnvs();
	});

	it("binds extensions in 'rpc' mode (the daemon's own character, distinct from 'tui') -- session_start-triggered narrowing still takes effect", async () => {
		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");

		const resourceLoader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: process.cwd(),
			noExtensions: true,
			extensionFactories: [narrowToReadOnlyExtension()],
		});
		await resourceLoader.reload();

		const { session, integration } = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "rpc",
			modelRuntime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
		});
		disposers.push(() => integration.dispose());

		expect(session.getActiveToolNames()).toEqual(["read"]);
	});

	it("returns a real AgentIntegrationPort backed by the constructed AgentSession", async () => {
		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");

		const { session, integration } = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "rpc",
			modelRuntime,
			resourceLoader: new DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.cwd(), noExtensions: true }),
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
		});
		disposers.push(() => integration.dispose());

		expect(typeof integration.prompt).toBe("function");
		expect(typeof integration.onEvent).toBe("function");
		expect(session.model).toBeDefined();
	});
});
