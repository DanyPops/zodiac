import { RuleTester } from "eslint";
import { parser as tsParser } from "typescript-eslint";
import { describe, it } from "vitest";
import { requireCueRegistration } from "./require-cue-registration.js";

// RuleTester has no test-framework dependency of its own here -- with no
// global describe/it (this repo's vitest config doesn't set `test.globals`),
// `.run()` just throws synchronously on the first mismatch, which a plain
// vitest `it()` catches like any other assertion failure.
const tester = new RuleTester({
	languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

describe("require-cue-registration", () => {
	it("passes/fails per RuleTester's own valid/invalid fixtures", () => {
		tester.run("require-cue-registration", requireCueRegistration, {
			valid: [
				// Calls registerCue somewhere in the file -- the real, enforced case.
				{ code: "import { registerCue } from '@zodiac/ui';\nfunction Card() { registerCue({ kind: 'x', id: 'y' }, { cue: 'highlight', description: 'd' }); return null; }", filename: "src/workspace/SurfaceTemplatesGallery.tsx" },
				// A file the glob matches but that's on the explicit allowlist -- allowed to have zero calls.
				{ code: "export function ChromeOnlySurface() { return null; }", filename: "src/workspace/PillarSurface.tsx", options: [{ allowlist: ["src/workspace/PillarSurface.tsx"] }] },
				// A file outside the enforced glob entirely -- never checked, regardless of content.
				{ code: "export function NotContentAtAll() { return null; }", filename: "src/workspace/NotContentAtAll.tsx" },
			],
			invalid: [
				{
					code: "export function Card() { return null; }",
					filename: "src/workspace/SurfaceTemplatesGallery.tsx",
					errors: [{ messageId: "missingRegistration" }],
				},
				{
					code: "export function AnotherOne() { return null; }",
					filename: "src/workspace/FooSurface.tsx",
					errors: [{ messageId: "missingRegistration" }],
				},
			],
		});
	});
});
