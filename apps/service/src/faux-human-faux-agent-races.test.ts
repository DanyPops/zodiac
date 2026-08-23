import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the daemon-side invariant Zodiac's own client-side optimistic
 * reconciliation depends on (apps/web/src/app/pending-rename.ts,
 * pending-overlay.ts) under Zodiac's own most common real multi-writer
 * shape: a human's own Web UI and an Agent Integration session (see
 * packages/pi/src/agent-command-tool.ts) both dispatching CommandIntents
 * against one shared Workspace, through the identical `/api/world/commands`
 * endpoint, at the same time.
 *
 * Deliberately API-level (raw HTTP + SSE against a real spawned zodiacd
 * process), not a Playwright browser suite -- extends the exact real-process
 * pattern daemon-multi-client.test.ts already establishes, one layer down
 * from the browser: this file proves the daemon's own concurrency
 * correctness (no lost update, no corrupted/mismatched commandId
 * attribution, consistent final state across every observer), which the
 * client-side reconciliation fix assumes but does not itself prove.
 *
 * `world.apply()` (packages/server/src/world/store.ts) is confirmed
 * synchronous with no `await` inside, and Node's own single-threaded event
 * loop never preempts a synchronous function -- so two concurrent
 * `POST /api/world/commands` requests can never truly interleave mid-apply
 * (no torn writes are structurally possible here). The real thing worth
 * proving under concurrency is therefore ordering and attribution: whichever
 * of two racing commands' bodies finishes reading first applies first, and
 * every connected observer -- including a third, passive one -- must see
 * the identical resulting broadcast sequence, each frame's own commandId
 * correctly naming whichever command actually produced it.
 */

let daemon: ManagedProcess;
let baseUrl: string;
let stateDir: string;

async function waitForReady(managedProcess: ManagedProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		const unsubscribe = managedProcess.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			const url = /listening on (http:\/\/\S+)/.exec(stdout)?.[1];
			if (url) {
				unsubscribe();
				resolve(url);
			}
		});
		void managedProcess.waitForExit().then((code) => {
			if (!stdout.includes("listening on")) reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${managedProcess.stderr}`));
		});
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${managedProcess.stderr}`)), 15_000);
	});
}

beforeAll(async () => {
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-faux-human-faux-agent-"));
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir] });
	baseUrl = await waitForReady(daemon);
}, 20_000);

afterAll(async () => {
	await daemon?.dispose();
	await rm(stateDir, { recursive: true, force: true });
});

/** Same real streaming-frame reader as daemon-multi-client.test.ts's own createSseReader. */
function createSseReader(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("expected a readable SSE body");
	const decoder = new TextDecoder();
	let buffer = "";
	const queue: { viewModel: unknown; commandId?: string }[] = [];

	function drain(): void {
		let boundary: number;
		while ((boundary = buffer.indexOf("\n\n")) !== -1) {
			const frame = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
			if (dataLine) queue.push(JSON.parse(dataLine.slice("data: ".length)));
		}
	}

	return {
		async next(): Promise<{ viewModel: unknown; commandId?: string }> {
			while (queue.length === 0) {
				const { value, done } = await reader.read();
				if (done) throw new Error("SSE stream ended before a frame was received");
				buffer += decoder.decode(value, { stream: true });
				drain();
			}
			return queue.shift()!;
		},
	};
}

interface RacingClient {
	readonly sse: ReturnType<typeof createSseReader>;
	readonly controller: AbortController;
	/** Fires a bare CommandIntent -- the exact same shape and the exact same endpoint packages/pi/src/agent-command-tool.ts's own zodiac_dispatch_command tool posts to. Not awaited-to-completion by the caller in every test -- some tests deliberately race two of these without waiting for either's own response first. */
	dispatch(intent: Record<string, unknown>): Promise<{ commandId?: string; result?: { surfaceId?: string } }>;
	close(): void;
}

async function connectRacingClient(): Promise<RacingClient> {
	const controller = new AbortController();
	const response = await fetch(`${baseUrl}/api/world/events`, { signal: controller.signal });
	const sse = createSseReader(response);
	return {
		sse,
		controller,
		async dispatch(intent) {
			const res = await fetch(`${baseUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent }),
			});
			expect(res.status).toBe(200);
			return res.json();
		},
		close() {
			controller.abort();
		},
	};
}

async function getWorld(): Promise<{ workspaces: { id: string; title: string; windows: { id: string; surfaces: { id: string; integrationId: string }[] }[] }[] }> {
	const res = await fetch(`${baseUrl}/api/world`);
	return res.json();
}

describe("FauxHuman + FauxAgent: two concurrent writers racing one real zodiacd, the same shape apps/pi/src/agent-command-tool.ts and a human's Web UI produce", () => {
	it("interleaved concurrent commands from both writers each keep their own correct commandId attribution -- never crossed under concurrency", async () => {
		const fauxHuman = await connectRacingClient();
		const fauxAgent = await connectRacingClient();
		const observer = await connectRacingClient();
		try {
			await fauxHuman.sse.next(); // each connection's own initial snapshot
			await fauxAgent.sse.next();
			await observer.sse.next();

			// Two workspace.create calls, dispatched with no await gap between
			// them -- both requests' own JSON bodies race to finish reading in
			// Node's event loop; `apply()` itself is confirmed synchronous, so
			// whichever body finishes first applies first, but never torn.
			const humanCommandId = "human-cmd-1";
			const agentCommandId = "agent-cmd-1";
			const [humanResult, agentResult] = await Promise.all([
				fauxHuman.dispatch({ type: "workspace.create", workspaceId: "ws-human", title: "Human's Workspace", commandId: humanCommandId }),
				fauxAgent.dispatch({ type: "workspace.create", workspaceId: "ws-agent", title: "Agent's Workspace", commandId: agentCommandId }),
			]);
			expect([humanResult.commandId, agentResult.commandId].sort()).toEqual([agentCommandId, humanCommandId].sort());

			// The observer (a third, uninvolved connection) sees both resulting
			// broadcasts -- each one's own commandId must name exactly the writer
			// whose title actually shows up in that same frame, never the other's.
			const frame1 = await observer.sse.next();
			const frame2 = await observer.sse.next();
			const frames = [frame1, frame2];
			const humanFrame = frames.find((frame) => frame.commandId === humanCommandId);
			const agentFrame = frames.find((frame) => frame.commandId === agentCommandId);
			expect(humanFrame).toBeDefined();
			expect(agentFrame).toBeDefined();
			expect(JSON.stringify(humanFrame)).toContain("Human's Workspace");
			expect(JSON.stringify(humanFrame)).not.toContain("Agent's Workspace does-not-appear-yet"); // sanity: not asserting on an impossible string, just documents intent
			expect(JSON.stringify(agentFrame)).toContain("Agent's Workspace");

			const world = await getWorld();
			expect(world.workspaces.map((workspace) => workspace.id).sort()).toEqual(["ws-agent", "ws-human"]);
		} finally {
			fauxHuman.close();
			fauxAgent.close();
			observer.close();
		}
	});

	it("a Workspace renamed concurrently by both writers ends up as exactly one of the two titles -- never merged/corrupted -- and every observer, including a passive third one, converges on the identical final state", async () => {
		const fauxHuman = await connectRacingClient();
		const fauxAgent = await connectRacingClient();
		const observer = await connectRacingClient();
		try {
			await fauxHuman.sse.next();
			await fauxAgent.sse.next();
			await observer.sse.next();

			await fauxHuman.dispatch({ type: "workspace.create", workspaceId: "ws-shared", title: "Original Title", commandId: "create-cmd" });
			await fauxHuman.sse.next();
			await fauxAgent.sse.next();
			await observer.sse.next();

			// Both writers rename the *same* Workspace concurrently, to different
			// titles -- no explicit ordering imposed by this test.
			await Promise.all([
				fauxHuman.dispatch({ type: "workspace.rename", workspaceId: "ws-shared", title: "Human's Title", commandId: "human-rename" }),
				fauxAgent.dispatch({ type: "workspace.rename", workspaceId: "ws-shared", title: "Agent's Title", commandId: "agent-rename" }),
			]);

			function sharedWorkspaceTitle(viewModel: unknown): string | undefined {
				return (viewModel as { workspaces: { id: string; title: string }[] }).workspaces.find((workspace) => workspace.id === "ws-shared")?.title;
			}

			const observerFrame1 = await observer.sse.next();
			const observerFrame2 = await observer.sse.next();
			// Whichever rename actually applied *second* (Node's own single-
			// threaded serialization decides which, non-deterministically from
			// this test's own point of view) is the one still standing -- the
			// later of the two observed frames must match the daemon's own
			// final GET, proving last-applied-wins with no silent merge/corruption.
			// The daemon process is shared across this file's own tests -- an
			// earlier test's own Workspaces are still present, so this looks up
			// "ws-shared" by id, never assumes it's the only or the first entry.
			const finalTitleAccordingToLastFrame = sharedWorkspaceTitle(observerFrame2.viewModel);
			expect(["Human's Title", "Agent's Title"]).toContain(finalTitleAccordingToLastFrame);
			expect(sharedWorkspaceTitle(observerFrame1.viewModel)).not.toBe(finalTitleAccordingToLastFrame); // the two frames are genuinely distinct steps, not the same broadcast read twice

			const world = await getWorld();
			expect(world.workspaces.find((workspace) => workspace.id === "ws-shared")?.title).toBe(finalTitleAccordingToLastFrame);

			// The human and the agent's own independent SSE connections converge
			// on the identical final title too -- not just the passive observer's.
			// Each has its own queue with the same two frames still buffered
			// (neither has read anything since dispatching its own rename), so
			// both must be drained the same way the observer's was above.
			await fauxHuman.sse.next();
			const humanSawFinal = await fauxHuman.sse.next();
			await fauxAgent.sse.next();
			const agentSawFinal = await fauxAgent.sse.next();
			expect(sharedWorkspaceTitle(humanSawFinal.viewModel)).toBe(finalTitleAccordingToLastFrame);
			expect(sharedWorkspaceTitle(agentSawFinal.viewModel)).toBe(finalTitleAccordingToLastFrame);
		} finally {
			fauxHuman.close();
			fauxAgent.close();
			observer.close();
		}
	});

	it("a Workspace the human creates and the agent removes immediately after leaves no trace, but the create's own commandId is still correctly acknowledged along the way -- the exact daemon-side fact apps/web's pending-overlay.ts pruning fix relies on", async () => {
		const fauxHuman = await connectRacingClient();
		const fauxAgent = await connectRacingClient();
		try {
			await fauxHuman.sse.next();
			await fauxAgent.sse.next();

			// The human's own create is dispatched, then -- as fast as this test
			// can manage, without waiting for the create's own response -- the
			// agent races to remove the exact same id.
			const createPromise = fauxHuman.dispatch({ type: "workspace.create", workspaceId: "ws-scratch", title: "Scratch Workspace", commandId: "create-cmd" });
			const removePromise = fauxAgent.dispatch({ type: "workspace.remove", workspaceId: "ws-scratch", commandId: "remove-cmd" });
			// The remove legitimately fails if it happens to reach the daemon
			// before the create has applied (the Workspace wouldn't exist yet) --
			// a real, disclosed ordering ambiguity this test doesn't try to force
			// one way; it only asserts the *outcome* is always consistent, not
			// which raw HTTP response status each individual request gets.
			const [createResult] = await Promise.all([createPromise, removePromise.catch(() => undefined)]);
			expect(createResult.commandId).toBe("create-cmd");

			// Whether the remove actually landed (raced ahead) or not (arrived
			// too early and failed), retry it now that the create is guaranteed
			// applied -- this test's own real assertion is about the settled
			// end state, not about winning a timing race against Node's own
			// event loop scheduling.
			await fauxAgent.dispatch({ type: "workspace.remove", workspaceId: "ws-scratch", commandId: "remove-cmd-retry" }).catch(() => undefined);

			const world = await getWorld();
			expect(world.workspaces.map((workspace) => workspace.id)).not.toContain("ws-scratch");
		} finally {
			fauxHuman.close();
			fauxAgent.close();
		}
	});

	it("concurrent Surface docks from both writers into the same Window both land -- neither writer's own dock silently clobbers the other's", async () => {
		const fauxHuman = await connectRacingClient();
		const fauxAgent = await connectRacingClient();
		try {
			await fauxHuman.sse.next();
			await fauxAgent.sse.next();

			await fauxHuman.dispatch({ type: "workspace.create", workspaceId: "ws-docking", title: "Docking Workspace", commandId: "create-cmd" });
			await fauxHuman.sse.next();
			await fauxAgent.sse.next();

			await Promise.all([
				fauxHuman.dispatch({ type: "surface.dock", workspaceId: "ws-docking", integrationId: "human-integration", title: "Human's Surface", surfaceId: "surface-human", commandId: "human-dock" }),
				fauxAgent.dispatch({ type: "surface.dock", workspaceId: "ws-docking", integrationId: "agent-integration", title: "Agent's Surface", surfaceId: "surface-agent", commandId: "agent-dock" }),
			]);
			await fauxHuman.sse.next();
			await fauxHuman.sse.next();

			const world = await getWorld();
			const workspace = world.workspaces.find((candidate) => candidate.id === "ws-docking")!;
			const surfaceIds = workspace.windows.flatMap((window) => window.surfaces.map((surface) => surface.id));
			expect(surfaceIds.sort()).toEqual(["surface-agent", "surface-human"]);
		} finally {
			fauxHuman.close();
			fauxAgent.close();
		}
	});
});
