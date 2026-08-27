import type { AgentIntegrationPort } from "@zodiac/agent";
import { workspaceId } from "@zodiac/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createRemoteZodiacAgentSession: vi.fn() }));

vi.mock("@zodiac/pi", () => ({
	createRemoteZodiacAgentSession: mocks.createRemoteZodiacAgentSession,
	createZodiacAgentSession: vi.fn(),
}));

import { startFooterChat } from "./start-footer-chat.js";

function integration(): AgentIntegrationPort {
	return {
		prompt: async () => undefined,
		steer: async () => undefined,
		followUp: async () => undefined,
		abort: async () => undefined,
		onEvent: () => () => undefined,
		onExit: () => () => undefined,
		dispose: vi.fn(),
	};
}

afterEach(() => vi.clearAllMocks());

describe("remote Workspace agent session", () => {
	it("carries the bootstrapped Workspace identity", async () => {
		const remote = integration();
		mocks.createRemoteZodiacAgentSession.mockResolvedValue({ sessionId: "session-1", integration: remote });

		const chat = await startFooterChat({
			cwd: "/repo",
			daemonUrl: "http://zodiacd.local",
			workspaceId: workspaceId("workspace-1"),
		});

		expect(mocks.createRemoteZodiacAgentSession).toHaveBeenCalledWith({
			baseUrl: "http://zodiacd.local",
			cwd: "/repo",
			workspaceId: workspaceId("workspace-1"),
		});
		chat?.dispose();
	});
});
