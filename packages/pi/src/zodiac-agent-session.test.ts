import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type InlineExtension, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
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

	it("zero-default invariant: an explicit empty initialActiveToolNames excludes Pi's own built-in tools, not just Vehicle-shaped ones", async () => {
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
			initialActiveToolNames: [],
		});
		disposers.push(() => integration.dispose());

		const activeToolNames = session.getActiveToolNames();
		expect(activeToolNames).toEqual([]);
		for (const builtin of ["read", "bash", "edit", "write"]) expect(activeToolNames).not.toContain(builtin);
	});

	it("omitting initialActiveToolNames preserves Pi's own SDK default -- only a caller with a real Workspace tool grant to enforce should opt in", async () => {
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

		expect(session.getActiveToolNames().sort()).toEqual(["bash", "edit", "read", "write"]);
	});

	it("customTools are registered and, together with an explicit initialActiveToolNames naming them, stay active even when built-ins are zeroed out", async () => {
		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");

		const customTool: ToolDefinition = {
			name: "zodiac_dispatch_command",
			label: "Zodiac Command",
			description: "test double",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
		};

		const { session, integration } = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "rpc",
			modelRuntime,
			resourceLoader: new DefaultResourceLoader({ cwd: process.cwd(), agentDir: process.cwd(), noExtensions: true }),
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
			initialActiveToolNames: [customTool.name],
			customTools: [customTool],
		});
		disposers.push(() => integration.dispose());

		expect(session.getActiveToolNames()).toEqual([customTool.name]);
		expect(session.getToolDefinition(customTool.name)).toBeDefined();
	});

	it("persists Zodiac-owned sessions and replaces the embedded session on fork", async () => {
		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");
		const agentDir = mkdtempSync(join(tmpdir(), "zodiac-agent-session-"));
		const created = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "rpc",
			agentDir,
			modelRuntime,
			resourceLoader: new DefaultResourceLoader({ cwd: process.cwd(), agentDir, noExtensions: true }),
			settingsManager: SettingsManager.inMemory(),
		});
		disposers.push(() => {
			created.integration.dispose();
			rmSync(agentDir, { recursive: true, force: true });
		});
		const initialSessionId = created.session.sessionId;
		const initialSessionPath = created.session.sessionFile;
		if (!initialSessionPath) throw new Error("expected a persisted session file");
		const userEntryId = created.session.sessionManager.appendMessage({ role: "user", content: "fork this", timestamp: Date.now() });

		expect(await created.integration.session!.fork(userEntryId)).toEqual({ ok: true });
		expect(created.session.sessionId).not.toBe(initialSessionId);
		expect(await created.integration.session!.resume(initialSessionPath)).toEqual({ ok: true });
		expect(created.session.sessionFile).toBe(initialSessionPath);
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
