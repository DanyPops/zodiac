import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider } from "@earendil-works/pi-ai/compat";
import { ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { VISUAL_CUE_PROPOSE_OPERATION_NAME } from "@zodiac/server/vehicle";
import { createZodiacAgentSession } from "@zodiac/pi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMonolithGovernance } from "./monolith-governance.js";

const REAL_PROVIDER_ENV_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "CODEX_API_KEY"];
const wellFormedInput = { title: "Meet your first Integration", steps: [{ target: { kind: "gallery-category", id: "lector" }, cue: "highlight" }] };

describe("buildMonolithGovernance", () => {
	const disposers: Array<() => void> = [];
	beforeEach(() => {
		for (const name of REAL_PROVIDER_ENV_VARS) vi.stubEnv(name, "");
	});
	afterEach(() => {
		while (disposers.length > 0) disposers.pop()?.();
		vi.unstubAllEnvs();
	});

	it("wires a real, working ApprovalCenter/VehicleRegistry in-process -- propose_visual_cue genuinely requires approval in Monolith mode, not just 'doesn't crash' (proves governance parity with apps/service's own composition root)", async () => {
		const governance = await buildMonolithGovernance(process.cwd());
		expect(governance.approvalCenter.pending()).toEqual([]);

		await expect(governance.vehicleClient.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput)).rejects.toThrow(/requires approval/);

		expect(governance.approvalCenter.pending()).toHaveLength(1);
		expect(governance.approvalCenter.pending()[0]).toMatchObject({ operationName: VISUAL_CUE_PROPOSE_OPERATION_NAME, operationVersion: 1 });
	});

	it("approving the pending request via the same real ApprovalCenter apps/service uses mints a capability that a retried invoke() accepts", async () => {
		const governance = await buildMonolithGovernance(process.cwd());

		const rejection = await governance.vehicleClient.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput).catch((error: unknown) => error);
		expect(rejection).toBeInstanceOf(Error);

		const pending = governance.approvalCenter.pending();
		expect(pending).toHaveLength(1);
		const capability = governance.approvalCenter.approve(pending[0]!.requestId);
		expect(capability).toBeDefined();

		const outcome = await governance.vehicleClient.invoke(VISUAL_CUE_PROPOSE_OPERATION_NAME, 1, wellFormedInput, { approvalCapability: capability });
		expect(outcome).toMatchObject({ accepted: true });
	});

	it("toolNames includes propose_visual_cue -- the one Vehicle operation Monolith mode can offer with full governance parity today", async () => {
		const governance = await buildMonolithGovernance(process.cwd());
		expect(governance.toolNames).toContain("propose_visual_cue");
	});

	it("projects propose_visual_cue as a real, active Pi tool in a real session built from this governance's own resourceLoader -- the same end-to-end wiring apps/service's daemon-side agent sessions use", async () => {
		const governance = await buildMonolithGovernance(process.cwd());

		const faux = fauxProvider();
		const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), allowModelNetwork: false });
		modelRuntime.registerNativeProvider(faux.provider);
		await modelRuntime.setRuntimeApiKey(faux.getModel().provider, "test-key");

		const { session, integration } = await createZodiacAgentSession({
			cwd: process.cwd(),
			mode: "tui",
			modelRuntime,
			resourceLoader: governance.resourceLoader,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory(),
		});
		disposers.push(() => integration.dispose());

		const tools = session.getAllTools().map((tool) => tool.name);
		expect(tools).toContain("propose_visual_cue");
		expect(session.getActiveToolNames()).toContain("propose_visual_cue");
	});
});
