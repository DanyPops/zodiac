import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { groupSessionsIntoConversations, type Conversation, type SessionMeta } from "../graph/conversation-grouping.js";

/**
 * Bounded scan of Alef's real local session store
 * (~/.local/share/alef/sessions/<cwd-hash>/<id>.jsonl), Node-only (fs access)
 * -- mirrors the existing dev-only bridge pattern in vite.config.ts.
 *
 * Explicit bounds, since real local data has directories with thousands of
 * session files (observed: one with 4695): only the most recently active
 * MAX_DIRS project directories are scanned, and at most MAX_SESSIONS_PER_DIR
 * sessions within each, capped overall at MAX_TOTAL_SESSIONS. This is a
 * resource bound, not a correctness guarantee -- older/less-active work is
 * simply not surfaced by this endpoint, which is the right tradeoff for
 * "useful to look at right now" rather than a complete archive browser.
 */
const MAX_DIRS = 30;
const MAX_SESSIONS_PER_DIR = 100;
const MAX_TOTAL_SESSIONS = 500;

interface SessionSummary {
	started_at?: string;
	turns?: number;
	errors?: number;
}

function readSessionName(filePath: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		const stream = createReadStream(filePath, { encoding: "utf8" });
		const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
		let resolved = false;
		// Correction: an earlier version of this only checked the first 5 lines,
		// on the assumption session.name is always the first event. Verified
		// against real current data that this is wrong -- Alef now also
		// auto-names sessions partway through (payload.source: "auto"), observed
		// at line 208 of a 221-line file, not the start. Reads the whole file
		// (still streamed, still bounded by the caller's MAX_TOTAL_SESSIONS/
		// MAX_SESSIONS_PER_DIR/MAX_DIRS caps) rather than guess a cutoff that
		// could miss a real name again.
		const finish = (value: string | undefined) => {
			if (resolved) return;
			resolved = true;
			rl.close();
			stream.destroy();
			resolve(value);
		};
		rl.on("line", (line) => {
			try {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				if (parsed.bus === "internal" && parsed.type === "session.name") {
					const payload = parsed.payload as Record<string, unknown> | undefined;
					const name = payload?.name;
					finish(typeof name === "string" ? name : undefined);
				}
			} catch {
				// malformed line, skip
			}
		});
		rl.on("close", () => finish(undefined));
		stream.on("error", () => finish(undefined));
	});
}

function readSummary(jsonlPath: string): SessionSummary | undefined {
	const summaryPath = jsonlPath.replace(/\.jsonl$/, ".summary.json");
	if (!existsSync(summaryPath)) return undefined;
	try {
		const raw = readFileSync(summaryPath, "utf8").trim();
		if (!raw) return undefined;
		return JSON.parse(raw) as SessionSummary;
	} catch {
		return undefined;
	}
}

/** Lists the MAX_DIRS most recently active session directories under the given root. */
function listRecentSessionDirs(sessionsRoot: string): string[] {
	if (!existsSync(sessionsRoot)) return [];
	const dirs = readdirSync(sessionsRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(sessionsRoot, d.name));

	const withMtime = dirs.map((dir) => {
		try {
			return { dir, mtimeMs: statSync(dir).mtimeMs };
		} catch {
			return { dir, mtimeMs: 0 };
		}
	});
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return withMtime.slice(0, MAX_DIRS).map((d) => d.dir);
}

function listRecentSessionFiles(dir: string): string[] {
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".jsonl"))
		.map((f) => join(dir, f));
	const withMtime = files.map((f) => {
		try {
			return { f, mtimeMs: statSync(f).mtimeMs };
		} catch {
			return { f, mtimeMs: 0 };
		}
	});
	withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return withMtime.slice(0, MAX_SESSIONS_PER_DIR).map((d) => d.f);
}

export async function scanConversations(sessionsRoot: string): Promise<Conversation[]> {
	const dirs = listRecentSessionDirs(sessionsRoot);
	const sessions: SessionMeta[] = [];

	for (const dir of dirs) {
		if (sessions.length >= MAX_TOTAL_SESSIONS) break;
		const files = listRecentSessionFiles(dir);
		for (const filePath of files) {
			if (sessions.length >= MAX_TOTAL_SESSIONS) break;
			const id = filePath.split("/").pop()?.replace(/\.jsonl$/, "") ?? filePath;
			const summary = readSummary(filePath);
			const name = await readSessionName(filePath);
			const startedAt = summary?.started_at ?? new Date(statSync(filePath).mtimeMs).toISOString();
			sessions.push({
				id,
				filePath,
				name,
				startedAt,
				turns: summary?.turns ?? 0,
				errors: summary?.errors ?? 0,
			});
		}
	}

	return groupSessionsIntoConversations(sessions);
}
