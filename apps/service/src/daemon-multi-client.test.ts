import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

/**
 * The one test in this repo that actually proves zodiacd's whole reason for
 * existing: a real, decoupled `zodiacd` process (the built dist/cli.js, spawned
 * as its own child process -- not wired into this test's own process the way
 * every other apps/service test does) with several independent "UI" clients
 * connected in parallel, changing state through one and observing it through
 * another. Mirrors apps/terminal's own *.pty.test.ts precedent of spawning the
 * real built binary rather than exercising route handlers in-process.
 *
 * Spawn/bounded-stderr/graceful-shutdown lifecycle is @danypops/pi-process-harness's
 * own spawnManagedProcess, not hand-rolled here -- this file used to
 * independently reimplement exactly that (a real, found duplication -- see
 * the "zodiacd adopts the ecosystem's real daemon handle-file..." Papyrus Task).
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
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-multi-client-"));
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--enable-terminal"] });
	baseUrl = await waitForReady(daemon);
}, 20_000);

afterAll(async () => {
	await daemon?.dispose();
	await rm(stateDir, { recursive: true, force: true });
});

/** Buffers raw SSE bytes and yields one parsed `data:` payload per completed frame -- a real streaming reader, not a single accumulated-string check. */
function createSseReader(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("expected a readable SSE body");
	const decoder = new TextDecoder();
	let buffer = "";
	const queue: unknown[] = [];

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
		async next(): Promise<unknown> {
			while (queue.length === 0) {
				const { value, done } = await reader.read();
				if (done) throw new Error("SSE stream ended before a frame was received");
				buffer += decoder.decode(value, { stream: true });
				drain();
			}
			return queue.shift();
		},
	};
}

interface UiClient {
	readonly sse: ReturnType<typeof createSseReader>;
	readonly controller: AbortController;
	createWorkspace(workspaceId: string, title: string): Promise<void>;
	close(): void;
}

async function connectUiClient(): Promise<UiClient> {
	const controller = new AbortController();
	const response = await fetch(`${baseUrl}/api/world/events`, { signal: controller.signal });
	const sse = createSseReader(response);
	return {
		sse,
		controller,
		async createWorkspace(workspaceId, title) {
			const res = await fetch(`${baseUrl}/api/world/commands`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ intent: { type: "workspace.create", workspaceId, title } }),
			});
			expect(res.status).toBe(200);
		},
		close() {
			controller.abort();
		},
	};
}

describe("zodiacd: a real decoupled daemon process, multiple parallel UI clients", () => {
	it("responds on its own real, decoupled process -- not the test's own process", async () => {
		const res = await fetch(`${baseUrl}/healthz`);
		expect(await res.text()).toBe("ok");
		// The whole point: this HTTP call crossed a real process boundary.
		expect(daemon.pid).not.toBe(process.pid);
	});

	it("boots with real World-chrome Panels seeded (workspace-nav left, surface-templates right), not an empty list", async () => {
		const res = await fetch(`${baseUrl}/api/world/panels`);
		const body = (await res.json()) as { panels: { id: string; location: string; body: string[] }[] };
		const byLocation = new Map(body.panels.map((panel) => [panel.location, panel]));
		expect(byLocation.get("left")).toMatchObject({ id: "workspace-nav", body: ["workspace-nav"] });
		expect(byLocation.get("right")).toMatchObject({ id: "surface-templates", body: ["surface-templates"] });
	});

	it("the real built-in Applet registry is actually wired in -- panel.move rejects a FormFactor violation, not silently accepted", async () => {
		// workspace-nav is vertical-only; "top" is horizontal -- this only rejects
		// if getApplet resolves a real AppletDefinition, proving seedBuiltinApplets
		// is live in this process, not the pre-this-task no-op.
		const res = await fetch(`${baseUrl}/api/world/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ intent: { type: "panel.move", panelId: "workspace-nav", placement: { location: "top", alignment: "center", offset: 0 } } }),
		});
		expect(res.status).toBe(400);
	});

	it("a change made through one UI client is observed, live, by another already-connected UI client", async () => {
		const uiA = await connectUiClient();
		const uiB = await connectUiClient();
		try {
			// Each client's own first frame is the current snapshot, independently delivered.
			const uiAInitial = await uiA.sse.next();
			const uiBInitial = await uiB.sse.next();
			expect(uiAInitial).toEqual(uiBInitial);

			await uiA.createWorkspace("ws-from-a", "From UI A");

			const uiASawIt = await uiA.sse.next();
			const uiBSawIt = await uiB.sse.next();
			// Both clients -- the one that made the change and the one that didn't
			// -- receive the identical broadcast frame, independently.
			expect(uiASawIt).toEqual(uiBSawIt);
			expect(JSON.stringify(uiBSawIt)).toContain("ws-from-a");
			expect(JSON.stringify(uiBSawIt)).toContain("From UI A");

			// State sharing is bidirectional, not "A publishes, B only ever reads".
			await uiB.createWorkspace("ws-from-b", "From UI B");
			const uiASawB = await uiA.sse.next();
			const uiBSawB = await uiB.sse.next();
			expect(uiASawB).toEqual(uiBSawB);
			expect(JSON.stringify(uiASawB)).toContain("ws-from-b");
		} finally {
			uiA.close();
			uiB.close();
		}
	});

	it("a UI client connecting after both changes above still sees the full accumulated state via a plain GET, not just an SSE tail", async () => {
		const res = await fetch(`${baseUrl}/api/world`);
		const body = (await res.json()) as { workspaces: { id: string }[] };
		expect(body.workspaces.map((workspace) => workspace.id)).toEqual(expect.arrayContaining(["ws-from-a", "ws-from-b"]));
	});

	it("a late-joining UI client's own SSE connection opens with the full current state as its first frame, not empty and not requiring replay", async () => {
		const uiC = await connectUiClient();
		try {
			const uiCInitial = await uiC.sse.next();
			expect(JSON.stringify(uiCInitial)).toContain("ws-from-a");
			expect(JSON.stringify(uiCInitial)).toContain("ws-from-b");
		} finally {
			uiC.close();
		}
	});

	it("cycling: a client repeatedly connecting and disconnecting never loses or corrupts state, and never disrupts a steady, simultaneously-connected client", async () => {
		const steady = await connectUiClient();
		try {
			await steady.sse.next(); // steady's own initial snapshot

			const cycleCount = 5;
			for (let i = 0; i < cycleCount; i++) {
				const transient = await connectUiClient();
				const transientInitial = await transient.sse.next();
				// Every reconnect gets the CURRENT snapshot -- proof state isn't
				// reset or forgotten by a client dropping off and a new one attaching.
				if (i === 0) {
					expect(JSON.stringify(transientInitial)).toContain("ws-from-a");
				} else {
					expect(JSON.stringify(transientInitial)).toContain(`ws-cycle-${i - 1}`);
				}

				await transient.createWorkspace(`ws-cycle-${i}`, `Cycle ${i}`);
				const transientSawOwnChange = await transient.sse.next();
				expect(JSON.stringify(transientSawOwnChange)).toContain(`ws-cycle-${i}`);

				const steadySawIt = await steady.sse.next();
				expect(JSON.stringify(steadySawIt)).toContain(`ws-cycle-${i}`);

				// Disconnect mid-cycle -- the next cycle's fresh connection must not
				// hang or error because a prior subscriber's cleanup misbehaved.
				transient.close();
			}

			// The daemon is still fully alive and serving accurate state afterward.
			const res = await fetch(`${baseUrl}/api/world`);
			const body = (await res.json()) as { workspaces: { id: string }[] };
			const ids = body.workspaces.map((workspace) => workspace.id);
			for (let i = 0; i < cycleCount; i++) expect(ids).toContain(`ws-cycle-${i}`);
		} finally {
			steady.close();
		}
	});
});

/** Same message-queue-not-one-shot-listener reasoning as terminal-routes.test.ts's own helper: a server can send its first frame before a caller gets around to attaching a listener. */
function wsMessageQueue(ws: WebSocket): { next(): Promise<unknown> } {
	const queue: unknown[] = [];
	const waiters: ((value: unknown) => void)[] = [];
	ws.on("message", (raw: Buffer) => {
		const parsed = JSON.parse(raw.toString("utf8"));
		const waiter = waiters.shift();
		if (waiter) waiter(parsed);
		else queue.push(parsed);
	});
	return {
		next(): Promise<unknown> {
			if (queue.length > 0) return Promise.resolve(queue.shift());
			return new Promise((resolve) => waiters.push(resolve));
		},
	};
}

function waitForWsOpen(ws: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve());
		ws.once("error", reject);
	});
}

/** Waits for a queue's next output frame whose data contains `text`, discarding shell noise (prompts, echoed input, ANSI) in between -- a real shell's own output around one command is not fully deterministic byte-for-byte. */
async function waitForOutputContaining(messages: { next(): Promise<unknown> }, text: string, maxFrames = 200): Promise<void> {
	for (let i = 0; i < maxFrames; i++) {
		const message = (await messages.next()) as { type: string; data?: string };
		if (message.type === "output" && message.data?.includes(text)) return;
	}
	throw new Error(`did not see output containing ${JSON.stringify(text)} within ${maxFrames} frames`);
}

describe("zodiacd: a real decoupled daemon process, a real shell shared by multiple parallel terminal clients", () => {
	it("a command typed by one WebSocket client's own terminal is observed, live, by another WebSocket client attached to the same real shell", async () => {
		const created = await fetch(`${baseUrl}/api/terminal/sessions`, { method: "POST" });
		expect(created.status).toBe(200);
		const { sessionId } = (await created.json()) as { sessionId: string };

		const wsBase = baseUrl.replace("http://", "ws://");
		const clientA = new WebSocket(`${wsBase}/api/terminal/sessions/${sessionId}`);
		const clientB = new WebSocket(`${wsBase}/api/terminal/sessions/${sessionId}`);
		const messagesA = wsMessageQueue(clientA);
		const messagesB = wsMessageQueue(clientB);
		try {
			await Promise.all([waitForWsOpen(clientA), waitForWsOpen(clientB)]);

			const marker = "zodiacd-multi-client-marker-12345";
			clientA.send(JSON.stringify({ type: "input", data: `echo ${marker}\n` }));

			// Both the client that typed the command and the one that didn't see
			// the exact same real shell output -- a real process boundary, a real
			// pty, two independent sockets.
			await Promise.all([waitForOutputContaining(messagesA, marker), waitForOutputContaining(messagesB, marker)]);

			// A third, late-joining client attaches to the same still-live shell
			// and gets the scrollback replay -- it never typed the command itself.
			const clientC = new WebSocket(`${wsBase}/api/terminal/sessions/${sessionId}`);
			const messagesC = wsMessageQueue(clientC);
			try {
				await waitForWsOpen(clientC);
				await waitForOutputContaining(messagesC, marker);
			} finally {
				clientC.close();
			}
		} finally {
			clientA.close();
			clientB.close();
		}
	}, 15_000);
});
