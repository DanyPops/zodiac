import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnManagedProcess, type ManagedProcess } from "@danypops/pi-process-harness";
import { afterEach, describe, expect, it } from "vitest";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;
const roots: string[] = [];
const daemons: ManagedProcess[] = [];

function temporaryRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function spawnZodiacd(stateDir: string, packageJsonPath: string): ManagedProcess {
	const daemon = spawnManagedProcess({ command: process.execPath, args: [cli, "--port", "0", "--host", "127.0.0.1", "--state-dir", stateDir, "--integration-package", packageJsonPath] });
	daemons.push(daemon);
	return daemon;
}

async function waitForStdout(process: ManagedProcess, pattern: RegExp, timeoutMs = 15_000): Promise<string> {
	return new Promise((resolve, reject) => {
		let stdout = "";
		const unsubscribe = process.onStdout((chunk) => {
			stdout += chunk.toString("utf8");
			if (pattern.test(stdout)) {
				unsubscribe();
				resolve(stdout);
			}
		});
		void process.waitForExit().then((code) => reject(new Error(`zodiacd exited (${code}) before ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)));
		setTimeout(() => reject(new Error(`timed out waiting for ${pattern}\nstdout: ${stdout}\nstderr: ${process.stderr}`)), timeoutMs);
	});
}

afterEach(async () => {
	await Promise.all(daemons.splice(0).map((daemon) => daemon.dispose()));
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("zodiacd configured Integration loading", () => {
	it("loads and activates a real configured editor module without a source-code import", async () => {
		const packageRoot = temporaryRoot("zodiac-configured-editor-");
		const stateDir = temporaryRoot("zodiac-configured-state-");
		const marker = join(packageRoot, "activated.txt");
		const entry = join(packageRoot, "editor.mjs");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/zodiac-lector",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] },
		}));
		writeFileSync(entry, `import { writeFileSync } from "node:fs";\nexport default { describe: () => ({ id: "fixture-lector", title: "Fixture Lector", commands: [], resourceSchemes: [], contributionPoints: ["editor"] }), activate: () => writeFileSync(${JSON.stringify(marker)}, "activated"), dispose: () => {} };\n`);

		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"));
		const stdout = await waitForStdout(daemon, /listening on http:\/\//);
		expect(stdout).toContain("loaded 1 configured Integration contribution");
		expect(stdout).toContain("@fixture/zodiac-lector/editor/fixture-lector");
		expect(existsSync(marker)).toBe(true);
		expect(readFileSync(marker, "utf8")).toBe("activated");
	});

	it("fails startup with package-scoped diagnostics for a malformed configured export", async () => {
		const packageRoot = temporaryRoot("zodiac-malformed-editor-");
		const stateDir = temporaryRoot("zodiac-malformed-state-");
		writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
			name: "@fixture/malformed",
			version: "1.0.0",
			zodiac: { integrations: [{ kind: "editor", entry: "./editor.mjs" }] },
		}));
		writeFileSync(join(packageRoot, "editor.mjs"), "export default {};\n");
		const daemon = spawnZodiacd(stateDir, join(packageRoot, "package.json"));
		expect(await daemon.waitForExit()).not.toBe(0);
		expect(daemon.stderr).toContain("@fixture/malformed editor entry must default-export a ZodiacContribution");
	});
});
