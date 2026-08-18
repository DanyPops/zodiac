import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readZodiacManifest, readZodiacManifestFile } from "./manifest.js";

describe("readZodiacManifest", () => {
	it("returns undefined for a package.json with no \"zodiac\" field", () => {
		expect(readZodiacManifest({ name: "some-package" })).toBeUndefined();
	});

	it("returns undefined for non-object input", () => {
		expect(readZodiacManifest(null)).toBeUndefined();
		expect(readZodiacManifest("not an object")).toBeUndefined();
	});

	it("parses a valid single-entry manifest", () => {
		const manifest = readZodiacManifest({ zodiac: { integrations: [{ kind: "editor", entry: "./src/index.ts" }] } });
		expect(manifest).toEqual({ integrations: [{ kind: "editor", entry: "./src/index.ts" }] });
	});

	it("parses a manifest declaring both known kinds", () => {
		const manifest = readZodiacManifest({
			zodiac: { integrations: [{ kind: "applet", entry: "./applet.js" }, { kind: "editor", entry: "./editor.js" }] },
		});
		expect(manifest?.integrations.map((entry) => entry.kind)).toEqual(["applet", "editor"]);
	});

	it("throws on an unknown contribution kind", () => {
		expect(() => readZodiacManifest({ zodiac: { integrations: [{ kind: "not-a-real-kind", entry: "./x.ts" }] } })).toThrow();
	});

	it("throws on an empty integrations array", () => {
		expect(() => readZodiacManifest({ zodiac: { integrations: [] } })).toThrow();
	});

	it("throws on a malformed \"zodiac\" field rather than silently contributing nothing", () => {
		expect(() => readZodiacManifest({ zodiac: "not an object" })).toThrow();
	});
});

describe("readZodiacManifestFile", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zodiac-manifest-test-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("reads and parses a package.json's own \"zodiac\" field", () => {
		const path = join(dir, "package.json");
		writeFileSync(path, JSON.stringify({ name: "@danypops/zodiac-lector", zodiac: { integrations: [{ kind: "editor", entry: "./src/index.ts" }] } }));
		expect(readZodiacManifestFile(path)).toEqual({ integrations: [{ kind: "editor", entry: "./src/index.ts" }] });
	});

	it("returns undefined for a package.json with no \"zodiac\" field", () => {
		const path = join(dir, "package.json");
		writeFileSync(path, JSON.stringify({ name: "some-package" }));
		expect(readZodiacManifestFile(path)).toBeUndefined();
	});
});
