import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AlignmentAgentEvent } from "./agent-integration-port.js";
import { createSubprocessAgentIntegration } from "./subprocess-agent-integration.js";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/fake-pi-rpc.mjs", import.meta.url));

function collectUntil(port: ReturnType<typeof createSubprocessAgentIntegration>, predicate: (event: AlignmentAgentEvent) => boolean, timeoutMs = 5000): Promise<AlignmentAgentEvent[]> {
	return new Promise((resolve, reject) => {
		const events: AlignmentAgentEvent[] = [];
		const timer = setTimeout(() => reject(new Error(`timed out waiting for event; collected ${events.length}`)), timeoutMs);
		const unsubscribe = port.onEvent((event) => {
			events.push(event);
			if (predicate(event)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(events);
			}
		});
	});
}

describe("createSubprocessAgentIntegration", () => {
	let integration: ReturnType<typeof createSubprocessAgentIntegration> | undefined;

	afterEach(() => {
		integration?.dispose();
		integration = undefined;
	});

	it("spawns a real child process and translates its PiRpcEvent stream into the same bounded event type the in-process adapter produces", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE] });
		const done = collectUntil(integration, (event) => event.type === "agent-settled");
		await integration.prompt("hello fixture");
		const events = await done;

		expect(events.map((event) => event.type)).toEqual([
			"agent-start",
			"tool-call-start",
			"tool-call-end",
			"assistant-message-start",
			"assistant-message-delta",
			"assistant-message-delta",
			"assistant-message-end",
			"agent-settled",
		]);
		expect(events.find((event) => event.type === "tool-call-start")).toMatchObject({ toolName: "bash", input: { command: "echo hi" } });
		expect(events.find((event) => event.type === "assistant-message-end")).toMatchObject({ text: "fake reply" });
	});

	it("steer() and followUp() both degrade to sending a plain prompt over the wire -- a known parity gap with the in-process adapter", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE] });
		const done = collectUntil(integration, (event) => event.type === "agent-settled");
		await integration.steer("steered message");
		await done;
		// The fixture only understands "prompt"/"abort" -- reaching agent-settled at all proves steer() was encoded as a prompt command, not silently dropped.
	});

	it("notifies onExit with a reason once the process exits abnormally", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", "-e", "process.exit(3)"] });
		const exit = new Promise<string | undefined>((resolve) => integration?.onExit(resolve));
		await expect(exit).resolves.toMatch(/exited with code 3/);
	});

	it("onExit reports no reason for a clean exit", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", "-e", "process.exit(0)"] });
		const exit = new Promise<string | undefined>((resolve) => integration?.onExit(resolve));
		await expect(exit).resolves.toBeUndefined();
	});

	it("does not throw when sending after the process has already exited", async () => {
		integration = createSubprocessAgentIntegration({ command: ["node", FIXTURE] });
		const exited = new Promise<void>((resolve) => integration?.onExit(() => resolve()));
		integration.dispose();
		await exited;
		await expect(integration.prompt("after exit")).resolves.toBeUndefined();
	});
});
