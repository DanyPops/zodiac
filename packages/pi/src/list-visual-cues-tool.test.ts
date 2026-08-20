import { registerCue } from "@zodiac/ui/cues";
import { createPendingClientActions } from "@zodiac/server/agent";
import { afterEach, describe, expect, it } from "vitest";
import { createHeadlessVisualCueClient, createListVisualCuesTool, createRemoteBrowserVisualCueClient } from "./list-visual-cues-tool.js";

/** See agent-command-tool.test.ts's own doc comment for why this shape/cast exists. */
function run(toolDefinition: { execute: unknown }, toolCallId: string, params: unknown): Promise<{ content: { type: string; text: string }[]; details: unknown }> {
	return (toolDefinition.execute as (toolCallId: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: { type: string; text: string }[]; details: unknown }>)(toolCallId, params, undefined, undefined, {});
}

describe("createHeadlessVisualCueClient", () => {
	const unregisters: Array<() => void> = [];
	afterEach(() => {
		while (unregisters.length > 0) unregisters.pop()?.();
	});

	it("listCues() reflects real registerCue calls made directly against the real registry -- no fakes-of-fakes", async () => {
		unregisters.push(registerCue({ kind: "gallery-category", id: "lector" }, { cue: "highlight", description: "Try Lector" }));
		const client = createHeadlessVisualCueClient();
		const cues = await client.listCues();
		expect(cues).toContainEqual(expect.objectContaining({ id: "lector", cue: "highlight" }));
	});

	it("listCues() no longer reports a cue once its own unregister function runs", async () => {
		const unregister = registerCue({ kind: "gallery-category", id: "pipes" }, { cue: "pulse", description: "Try Pipes" });
		const client = createHeadlessVisualCueClient();
		expect(await client.listCues()).toContainEqual(expect.objectContaining({ id: "pipes" }));
		unregister();
		expect(await client.listCues()).not.toContainEqual(expect.objectContaining({ id: "pipes" }));
	});
});

describe("list_visual_cues (the Pi tool)", () => {
	const unregisters: Array<() => void> = [];
	afterEach(() => {
		while (unregisters.length > 0) unregisters.pop()?.();
	});

	it("given a HeadlessVisualCueClient with two registered cues, reports both in its tool-call result -- fully deterministic, no network", async () => {
		unregisters.push(registerCue({ kind: "gallery-category", id: "papyrus" }, { cue: "highlight", description: "Try Papyrus" }));
		unregisters.push(registerCue({ kind: "gallery-category", id: "tickets" }, { cue: "pulse", description: "Try Tickets" }));
		const tool = createListVisualCuesTool(() => createHeadlessVisualCueClient());

		const result = await run(tool, "call-1", {});

		expect(result.details).toMatchObject({ observed: true });
		const details = result.details as { cues: readonly { id: string }[] };
		expect(details.cues.map((cue) => cue.id).sort()).toEqual(["papyrus", "tickets"]);
	});

	it("reports observed: false, never throws, when the underlying client reports no Client was ever observed", async () => {
		const pendingClientActions = createPendingClientActions();
		const tool = createListVisualCuesTool((toolCallId) => createRemoteBrowserVisualCueClient(pendingClientActions, toolCallId, 10));

		const result = await run(tool, "call-2", {});

		expect(result.details).toEqual({ observed: false, cues: [] });
	});
});

describe("createRemoteBrowserVisualCueClient", () => {
	it("a real announce-then-POST round trip (using the real toolCallId as correlation id) resolves with whatever the Client posted back", async () => {
		const pendingClientActions = createPendingClientActions();
		const client = createRemoteBrowserVisualCueClient(pendingClientActions, "call-3", 2_000);

		const listPromise = client.listCues();
		// Simulates the real Client's own POST-back, keyed by the same toolCallId
		// the daemon announced via a real tool-call-start SSE event.
		pendingClientActions.resolve("call-3", { cues: [{ kind: "gallery-category", id: "jittor", cue: "highlight", description: "Try Jittor" }] });

		await expect(listPromise).resolves.toEqual([{ kind: "gallery-category", id: "jittor", cue: "highlight", description: "Try Jittor" }]);
	});

	it("with zero connected Clients, rejects with NoClientObservedError after its own timeout -- distinct from resolving with an empty list, and never hangs", async () => {
		const pendingClientActions = createPendingClientActions();
		const client = createRemoteBrowserVisualCueClient(pendingClientActions, "call-4", 10);

		await expect(client.listCues()).rejects.toThrow(/No Client posted a result/);
	});
});
