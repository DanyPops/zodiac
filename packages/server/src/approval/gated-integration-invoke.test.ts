import { HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import { integrationId, workspaceId, worldId, type ContributionOutcome } from "@zodiac/protocol";
import { describe, expect, it } from "vitest";
import { createEventBus } from "../event/bus.js";
import { createWorldStore } from "../world/store.js";
import { createApprovalCenter } from "./approval-center.js";
import { createGatedIntegrationInvokeHandler } from "./gated-integration-invoke.js";

/** The same fixture Integration shape store.test.ts's own "integration.invoke" describe block uses, gated instead of always-on -- proving out the real thing those fixtures were "deliberately too simple for" (this task's own doc comment). */
function fixtureSymbolSearchHandler(calls: { action: string; input: unknown }[]) {
	return (action: string, input: unknown): ContributionOutcome<unknown> => {
		calls.push({ action, input });
		if (action !== "symbol.search") return { ok: false, code: "unknown-action", message: `unknown action "${action}"` };
		const { query } = input as { query?: string };
		return { ok: true, value: { matches: [`${query}#1`] } };
	};
}

function setup() {
	const bus = createEventBus();
	const authority = new HmacApprovalAuthority();
	const approvalCenter = createApprovalCenter({ bus, authority });
	const store = createWorldStore(worldId("w1"));
	store.createWorkspace(workspaceId("ws"), "WS");
	const calls: { action: string; input: unknown }[] = [];
	const realHandler = fixtureSymbolSearchHandler(calls);
	const gatedHandler = createGatedIntegrationInvokeHandler({ handler: realHandler, approvalCenter, operationName: "lector.symbol.search", operationVersion: 1, effect: "destructive" });
	store.registerIntegrationInvokeHandler(integrationId("lector"), gatedHandler);
	return { store, approvalCenter, calls };
}

describe("createGatedIntegrationInvokeHandler", () => {
	it("item 1: a gated operation invoked with no capability durably emits a VehicleApprovalRequest before the real handler ever runs", () => {
		const { store, approvalCenter, calls } = setup();

		const outcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: { query: "createWorldStore" } });

		expect(calls).toEqual([]); // the real handler never ran
		expect(outcome.invokeResult).toMatchObject({ ok: false, code: "approval-required" });
		const pending = approvalCenter.pending();
		expect(pending).toHaveLength(1);
		expect(pending[0]).toMatchObject({ operationName: "lector.symbol.search", operationVersion: 1, effect: "destructive" });
	});

	it("an ungated effect (e.g. read) passes straight through with no approval involvement at all", () => {
		const bus = createEventBus();
		const approvalCenter = createApprovalCenter({ bus });
		const store = createWorldStore(worldId("w1"));
		store.createWorkspace(workspaceId("ws"), "WS");
		const calls: { action: string; input: unknown }[] = [];
		const gatedHandler = createGatedIntegrationInvokeHandler({ handler: fixtureSymbolSearchHandler(calls), approvalCenter, operationName: "lector.symbol.search", operationVersion: 1, effect: "read" });
		store.registerIntegrationInvokeHandler(integrationId("lector"), gatedHandler);

		const outcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: { query: "x" } });

		expect(outcome.invokeResult).toEqual({ ok: true, value: { matches: ["x#1"] } });
		expect(approvalCenter.pending()).toEqual([]);
	});

	it("item 3: approving mints a capability that, presented on a resubmitted intent, lets the operation proceed and produce the exact same result a direct always-authorized call would", () => {
		const { store, approvalCenter, calls } = setup();
		const input = { query: "createWorldStore" };

		store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input });
		const [request] = approvalCenter.pending();
		const capability = approvalCenter.approve(request!.requestId);
		expect(capability).toBeDefined();

		const reinvokedOutcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input, approvalCapability: capability });

		// The direct, always-authorized baseline this must match byte-for-byte.
		const directCalls: { action: string; input: unknown }[] = [];
		const directResult = fixtureSymbolSearchHandler(directCalls)("symbol.search", input);

		expect(reinvokedOutcome.invokeResult).toEqual(directResult);
		expect(calls).toEqual([{ action: "symbol.search", input }]); // the real handler ran exactly once, only after approval
		expect(approvalCenter.pending()).toEqual([]); // resolved, not still pending
	});

	it("item 4: denying means verify() never succeeds for that request -- a resubmission with no (or a stale) capability never runs the real handler", () => {
		const { store, approvalCenter, calls } = setup();
		const input = { query: "createWorldStore" };

		store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input });
		const [request] = approvalCenter.pending();
		approvalCenter.deny(request!.requestId);

		const resubmitted = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input });

		expect(calls).toEqual([]); // never ran, denial or not
		expect(resubmitted.invokeResult).toMatchObject({ ok: false, code: "approval-required" });
	});

	it("item 4b: a capability presented for a different input than it was minted for is rejected -- confused-deputy guard survives the full handler wrapper, not just the authority level", () => {
		const { store, approvalCenter, calls } = setup();
		store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: { query: "createWorldStore" } });
		const [request] = approvalCenter.pending();
		const capability = approvalCenter.approve(request!.requestId);

		const outcome = store.apply({ type: "integration.invoke", workspaceId: workspaceId("ws"), integrationId: integrationId("lector"), action: "symbol.search", input: { query: "a-different-query" }, approvalCapability: capability });

		expect(calls).toEqual([]);
		expect(outcome.invokeResult).toMatchObject({ ok: false, code: "approval-capability-invalid" });
	});
});
