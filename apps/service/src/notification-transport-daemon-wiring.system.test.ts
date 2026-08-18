import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Proves the real zodiacd binary constructs a real EventBus/ApprovalCenter for the first time
 * (per the "Wire a live daemon->browser notification transport" Papyrus Task) -- before this,
 * neither was ever constructed in the running daemon at all, and no route exposed the
 * "notification" channel. notification-routes.test.ts already covers the route's own logic
 * against a fake bus/ApprovalCenter; this covers the actual wiring: does cli.ts's own
 * construction reach the real HTTP server, end to end, against the real compiled binary.
 */
type ZodiacdProcess = ChildProcessByStdio<null, Readable, Readable>;

let daemon: ZodiacdProcess;
let baseUrl: string;
let stateDir: string;

async function waitForReady(child: ZodiacdProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		let stderr = "";
		const onData = (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
			const match = /listening on (http:\/\/\S+)/.exec(stdout);
			const url = match?.[1];
			if (url) {
				child.stdout.off("data", onData);
				resolve(url);
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});
		child.once("exit", (code) => reject(new Error(`zodiacd exited early (code ${code}) before reporting ready.\nstderr: ${stderr}`)));
		child.once("error", reject);
		setTimeout(() => reject(new Error(`zodiacd did not report ready within 15s.\nstdout: ${stdout}\nstderr: ${stderr}`)), 15_000);
	});
}

beforeAll(async () => {
	stateDir = await mkdtemp(join(tmpdir(), "zodiacd-notification-transport-wiring-"));
	const cli = new URL("../dist/cli.js", import.meta.url).pathname;
	daemon = spawn(process.execPath, [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir], { stdio: ["ignore", "pipe", "pipe"] });
	baseUrl = await waitForReady(daemon);
}, 20_000);

afterAll(async () => {
	if (daemon && !daemon.killed) {
		daemon.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			daemon.once("exit", () => resolve());
			setTimeout(resolve, 2000);
		});
	}
	await rm(stateDir, { recursive: true, force: true });
});

describe("zodiacd's own cli.ts constructs a real EventBus/ApprovalCenter and exposes it over /api/notifications", () => {
	it("GET /api/notifications streams an empty pending snapshot when nothing has ever been requested", async () => {
		const controller = new AbortController();
		const response = await fetch(`${baseUrl}/api/notifications`, { signal: controller.signal });
		expect(response.headers.get("content-type")).toContain("text/event-stream");

		const reader = response.body?.getReader();
		if (!reader) throw new Error("expected a readable body");
		const { value } = await reader.read();
		const frame = JSON.parse(new TextDecoder().decode(value).replace(/^data: /, "").trim()) as { type: string; pending: unknown[] };
		expect(frame).toEqual({ type: "notifications.snapshot", pending: [] });

		controller.abort();
	});

	it("POST /api/notifications/:id/approve against a real (never-pending) id returns 404, not a crash -- proves the real route/ApprovalCenter wiring, not just that the endpoint exists", async () => {
		const response = await fetch(`${baseUrl}/api/notifications/never-requested/approve`, { method: "POST" });
		expect(response.status).toBe(404);
	});

	it("POST /api/notifications/:id/deny against a real (never-pending) id is a no-op 200, matching ApprovalCenter.deny()'s own documented idempotence", async () => {
		const response = await fetch(`${baseUrl}/api/notifications/never-requested/deny`, { method: "POST" });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});
});
