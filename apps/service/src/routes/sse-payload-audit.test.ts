import { describe, expect, it } from "vitest";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { createWorldStore } from "@zodiac/server/world";
import { integrationId, surfaceId, workspaceId, worldId } from "@zodiac/protocol";
import type { ZodiacAgentEvent } from "@zodiac/agent";
import { DEFAULT_MAX_SSE_BUFFERED_BYTES } from "./sse-writer.js";

/**
 * TDD item 3 of the "Audit zodiacd's SSE routes" Papyrus Task: grounds DEFAULT_MAX_SSE_BUFFERED_BYTES
 * (4MB) in this codebase's own real data shapes, rather than a guessed constant. Two different
 * questions, both real: (1) does a single legitimate frame ever come close to the cap on its own
 * (it must stay comfortably under, or the cap would false-positive-kill a healthy client -- the
 * exact failure mode world-routes.test.ts's own "healthy client" test had to design around); (2)
 * does a plausible worst-case backlog (many undrained events for a genuinely stuck client)
 * meaningfully exceed it (it must, or the cap does nothing).
 */
describe("SSE payload sizes against DEFAULT_MAX_SSE_BUFFERED_BYTES (4MB), grounded in this codebase's real data shapes", () => {
	it("a realistic (not deliberately huge) full WorldViewModel snapshot stays comfortably under the cap -- a legitimate single frame must never trip it", () => {
		// A generously large real Workspace: 20 Workspaces, 15 docked Surfaces each (300 Surfaces
		// total) -- well beyond what a single human's Workspace count would realistically reach
		// (see the "First-run capability-gap walkthrough" Task's own onboarding-scale assumptions),
		// deliberately erring toward the high end of plausible, not the average case.
		const world = createWorldStore(worldId("w1"));
		for (let workspaceIndex = 0; workspaceIndex < 20; workspaceIndex += 1) {
			const wsId = workspaceId(`ws-${String(workspaceIndex)}`);
			world.createWorkspace(wsId, `Workspace ${String(workspaceIndex)}`);
			for (let surfaceIndex = 0; surfaceIndex < 15; surfaceIndex += 1) {
				world.dockSurface(wsId, integrationId(`int-${String(surfaceIndex)}`), `Surface ${String(surfaceIndex)}`, surfaceId(`s-${String(workspaceIndex)}-${String(surfaceIndex)}`));
			}
		}

		const bytes = Buffer.byteLength(JSON.stringify(world.worldViewModel()));
		expect(bytes).toBeLessThan(DEFAULT_MAX_SSE_BUFFERED_BYTES / 10); // an order of magnitude of headroom, not a hairline margin
	});

	it("a realistic single ZodiacAgentEvent (including a moderately large tool-call-end output) stays comfortably under the cap", () => {
		// tool-call-end's own `output: unknown` is the real, concrete unbounded-payload risk this
		// Task's own body named -- a `read` tool call over a genuinely large file. 200KB stands in
		// for a large-but-plausible single file read (well beyond typical source file sizes).
		const event: ZodiacAgentEvent = { type: "tool-call-end", toolCallId: "tc-1", toolName: "read", output: { content: "x".repeat(200_000) }, isError: false };
		const bytes = Buffer.byteLength(JSON.stringify(event));
		expect(bytes).toBeLessThan(DEFAULT_MAX_SSE_BUFFERED_BYTES / 10);
	});

	it("a full, MAX_HISTORY_EVENTS-sized (5,000) session history replay of realistic events would meaningfully exceed the cap if genuinely undrained -- confirming the per-connection cap is a real, not vacuous, protection for this exact route", () => {
		// Realistic per-event size: a normal assistant-message-delta chunk plus occasional
		// moderate tool outputs (not the 200KB worst case above, an ordinary handful of KB) --
		// grounding "the cap matters" in a genuinely plausible backlog, not a contrived one.
		const events: ZodiacAgentEvent[] = [];
		for (let index = 0; index < 5_000; index += 1) {
			events.push(
				index % 20 === 0
					? { type: "tool-call-end", toolCallId: `tc-${String(index)}`, toolName: "read", output: { content: "x".repeat(4_000) }, isError: false }
					: { type: "assistant-message-delta", text: "The quick brown fox jumps over the lazy dog. ".repeat(10) },
			);
		}
		const totalBytes = events.reduce((sum, event) => sum + Buffer.byteLength(JSON.stringify(event)), 0);
		// A real, concrete number confirming the risk this Task's own body raised is genuine for
		// zodiacd's own MAX_HISTORY_EVENTS bound, not just opencode's own unrelated codebase: a full
		// realistic history replay to a client that never drains a single byte of it comes to
		// roughly 3.4MB -- this exact measurement is what drove DEFAULT_MAX_SSE_BUFFERED_BYTES down
		// from an initially-guessed 4MB (which this real backlog would have sat comfortably under,
		// making the cap a no-op for exactly the scenario this Task's own body worried about) to a
		// measured, real 2MB -- see sse-writer.ts's own doc comment for the full recalibration story.
		expect(totalBytes).toBeGreaterThan(DEFAULT_MAX_SSE_BUFFERED_BYTES);
	});

	it("a realistic pending VehicleApprovalRequest list stays comfortably under the cap even at a generous pending count", () => {
		// 200 simultaneously pending approval requests is already an extreme operational scenario
		// (see ApprovalCenter's own doc comment on what "pending" represents) -- errs high, not
		// toward a realistic average.
		const pending: VehicleApprovalRequest[] = Array.from({ length: 200 }, (_, index) => ({
			requestId: `REQ-${String(index)}`,
			operationName: "visual-cue.propose",
			operationVersion: 1,
			effect: "external-write",
			requestedAt: Date.now(),
			expiresAt: Date.now() + 5 * 60_000,
			inputHash: "deadbeef".repeat(4),
		}));
		const bytes = Buffer.byteLength(JSON.stringify({ type: "notifications.snapshot", pending }));
		expect(bytes).toBeLessThan(DEFAULT_MAX_SSE_BUFFERED_BYTES / 10);
	});
});
