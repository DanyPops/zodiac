import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { windowId, workspaceId, worldId } from "@zodiac/protocol";
import { hydrateWorldStore } from "./store.js";
import { createJsonFileSnapshotPort } from "./json-file-snapshot-port.js";

describe("createJsonFileSnapshotPort", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "zodiac-world-snapshot-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("load() resolves undefined when no snapshot file exists yet -- a fresh daemon, not an error", async () => {
		const port = createJsonFileSnapshotPort({ filePath: join(dir, "does-not-exist", "world.json") });
		expect(await port.load()).toBeUndefined();
	});

	it("round-trips a real World through save() then load(), consumable by hydrateWorldStore", async () => {
		const filePath = join(dir, "world.json");
		const port = createJsonFileSnapshotPort({ filePath });
		const world = { id: worldId("w1"), workspaces: [{ id: workspaceId("ws"), title: "WS", windows: [{ id: windowId("window-1"), title: "Window 0", surfaces: [] }], activeWindowIndex: 0 }] };

		await port.save(world);
		const loaded = await port.load();
		expect(loaded).toEqual(world);

		const hydrated = hydrateWorldStore(loaded);
		expect(hydrated.ok).toBe(true);
	});

	it("creates the parent directory if it doesn't exist yet", async () => {
		const filePath = join(dir, "nested", "deeper", "world.json");
		const port = createJsonFileSnapshotPort({ filePath });
		await port.save({ id: worldId("w1"), workspaces: [] });
		expect(await port.load()).toEqual({ id: "w1", workspaces: [] });
	});

	it("a second save() overwrites the first -- load() always sees the latest", async () => {
		const filePath = join(dir, "world.json");
		const port = createJsonFileSnapshotPort({ filePath });
		await port.save({ id: worldId("w1"), workspaces: [] });
		await port.save({ id: worldId("w1"), workspaces: [{ id: workspaceId("ws"), title: "WS", windows: [{ id: windowId("window-1"), title: "Window 0", surfaces: [] }], activeWindowIndex: 0 }] });
		const loaded = await port.load();
		expect(loaded).toMatchObject({ workspaces: [{ id: "ws" }] });
	});

	it("save() writes atomically -- no leftover temp file after a successful write", async () => {
		const filePath = join(dir, "world.json");
		const port = createJsonFileSnapshotPort({ filePath });
		await port.save({ id: worldId("w1"), workspaces: [] });
		const entries = await readdir(dir);
		expect(entries).toEqual(["world.json"]);
	});

	it("load() rejects on a corrupted snapshot file instead of silently discarding it", async () => {
		const filePath = join(dir, "world.json");
		const { writeFile } = await import("node:fs/promises");
		await writeFile(filePath, "{ not valid json", "utf8");
		const port = createJsonFileSnapshotPort({ filePath });
		await expect(port.load()).rejects.toThrow();
	});
});
