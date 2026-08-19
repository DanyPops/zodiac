import { LocalVehicleClient } from "@danypops/vehicle-client/local";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { registerVisualCueOperations } from "@zodiac/server/vehicle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisualCueVehicleResourceLoader } from "./visual-cue-vehicle-tool.js";
import { createZodiacAgentSession } from "./zodiac-agent-session.js";

const REAL_PROVIDER_ENV_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"];

describe("createVisualCueVehicleResourceLoader + registerVehicleTools, end to end against a real session", () => {
	const disposers: Array<() => void> = [];
	beforeEach(() => {
		for (const name of REAL_PROVIDER_ENV_VARS) vi.stubEnv(name, "");
	});
	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
		vi.unstubAllEnvs();
	});

	it("item 4: projects visual-cue.propose as a real Pi tool named propose_visual_cue -- not the operation's own default slugged name -- discoverable and active in a real session", async () => {
		const registry = new VehicleRegistry({ name: "zodiac", version: "1", description: "Test." });
		registerVisualCueOperations(registry);
		registry.configureApprovals({});
		const client = new LocalVehicleClient(registry);

		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");

		const resourceLoader = await createVisualCueVehicleResourceLoader(client, process.cwd(), process.cwd());

		const { session, integration } = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "rpc",
			modelRuntime,
			resourceLoader,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
		});
		disposers.push(() => integration.dispose());

		const tools = session.getAllTools().map((tool) => tool.name);
		expect(tools).toContain("propose_visual_cue");
		expect(tools).not.toContain("visual_cue_propose"); // the operation's own default slugged name -- confirms the custom toolName projector actually took effect, not a fallback
		expect(session.getActiveToolNames()).toContain("propose_visual_cue");
	});
});
