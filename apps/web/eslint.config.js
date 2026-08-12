// @ts-check
import js from "@eslint/js";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

// Zodiac's own architecture rules, enforced as real ESLint rules against
// the parsed AST instead of the retired scripts/architecture-boundaries.mjs
// text scan. That regex-based version had two real defects an AST rule
// can't have: it matched the bare word "window" inside JSX prose (a false
// positive, since fixed by narrowing the regex), and its "no .tsx import"
// check could never fire at all, because this codebase's own import
// convention always writes ".js" even when importing a .tsx file --
// dead code that looked like coverage but tested nothing. `no-restricted-imports`
// below bans the framework import that actually matters (react/react-dom)
// by its resolved specifier, and `no-restricted-globals` matches genuine
// identifier references, not substrings of unrelated text.

const DOMAIN_FILES = ["src/workspace/model.ts", "src/conversation/projector.ts", "src/graph/conversation-grouping.ts", "src/graph/observability-graph.ts", "src/graph/session-graph.ts", "src/ingest/types.ts"];

// Files allowed to reference a browser/fetch global directly -- everything
// else must go through ConversationClient/Preferences/ThemeController.
const ADAPTER_ALLOWLIST = [
	"src/app/App.tsx", // composition root: reads window.localStorage once to build the Preferences adapter
	"src/main.tsx", // entry point: mounts React onto a real DOM node
	"src/theme.ts", // ThemeController's own browser adapter factory
	"src/conversation/client.ts", // ConversationClient's own fetch adapter factory (fetch is its injectable default, never called literally here)
	"src/pi/client.ts", // PiClient's own fetch/EventSource adapter factory (both are injectable defaults, never called literally here)
	"src/platform/pointer.ts", // PointerTracker's own browser adapter factory
	"src/platform/visual-dna-style.ts", // VisualDnaStyleTarget's own browser adapter factory
	"src/platform/wisp-target-measurer.ts", // WispTargetMeasurer's own browser adapter factory
	"src/platform/drag-tracker.ts", // DragTracker's own browser adapter factory
];

const RESTRICTED_GLOBALS = [
	{ name: "window", message: "Reach in through a port (ConversationClient/Preferences/ThemeController) instead of the global." },
	{ name: "document", message: "Reach in through a port (ConversationClient/Preferences/ThemeController) instead of the global." },
	{ name: "localStorage", message: "Reach in through the Preferences port instead of the global." },
	{ name: "fetch", message: "Reach in through a client port (ConversationClient/PiClient) instead of the global." },
];

export default tseslint.config(
	{ ignores: ["dist/**", "playwright-report/**", "test-results/**", "coverage/**"] },

	// Application/UI source: standard React + TypeScript rules.
	//
	// eslint-plugin-react-hooks@7's own "recommended-latest"/"flat" configs
	// still embed a legacy `plugins: ["react-hooks"]` array (eslintrc-style),
	// which ESLint 10's flat config rejects outright -- so its `rules` are
	// applied directly against a properly-shaped `plugins` object instead of
	// spreading the plugin's own config export.
	{
		files: ["src/**/*.{ts,tsx}"],
		extends: [js.configs.recommended, tseslint.configs.recommended, reactRefresh.configs.vite],
		plugins: { "react-hooks": reactHooks },
		rules: {
			...reactHooks.configs["recommended-latest"].rules,
			// SRP signal: one class per file keeps a class's reason to change
			// visible at the file level. Currently satisfied trivially (one
			// class, SessionGraph, already alone in its own file); this just
			// keeps it that way as the codebase grows.
			"max-classes-per-file": ["error", 1],
			// Deferred, not silently dropped: eslint-plugin-react-hooks v7 folded
			// React Compiler's readiness heuristics into "recommended" (2 rules ->
			// ~16). Several real projects hit the same wall on upgrade (WordPress
			// Gutenberg, Altinn/altinn-studio, others) and independently reached
			// the same response: keep the stable core (rules-of-hooks,
			// exhaustive-deps) and every compiler rule that passes cleanly, but
			// turn off the ones that fire on load-bearing, legitimate patterns
			// until each is deliberately revisited -- not as a blanket escape
			// hatch, but because we don't use the React Compiler here at all, so
			// these are readiness heuristics for a compiler we haven't adopted.
			//
			// "refs": flags App.tsx's command-registry actions object because it
			// can't statically prove ref reads inside its closures only happen
			// from a later click/keypress dispatch, never during the render that
			// constructs the object.
			//
			// "set-state-in-effect": flags the standard fetch-with-AbortController
			// effect (useConversationWorkspace, useWorkspace) and a mode-changed
			// reset effect (CommandDialog) that also cancels an external hotkey
			// recorder -- both synchronize with an external system, which is
			// exactly what an effect is for.
			"react-hooks/refs": "off",
			"react-hooks/set-state-in-effect": "off",
		},
		languageOptions: {
			ecmaVersion: 2022,
			globals: globals.browser,
		},
	},

	// Type-aware linting: catches bugs plain syntactic rules can't (unsound
	// substitutions, unchecked promise rejection, unsafe narrowing) -- the
	// same tseslint.configs.recommendedTypeChecked baseline ~/Workspace/alef
	// runs on its own core packages. Uses parserOptions.projectService
	// (typescript-eslint's own recommended option since v8, replacing the
	// older parserOptions.project glob) so ESLint reuses the same project
	// analysis TypeScript's own language service builds, instead of
	// constructing a second, separately-configured one.
	//
	// Scoped off test files: fixtures intentionally exercise loose/partial
	// shapes that would fight these rules for no real benefit, the same
	// carve-out alef makes for its own packages/*/test/.
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["**/*.test.{ts,tsx}"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// ── Correctness a type checker alone won't force you to handle ──────
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/prefer-nullish-coalescing": "error",
			"@typescript-eslint/no-unnecessary-condition": "error",

			// ── Interfaces: soundness, not just style ───────────────────────────
			// Object shapes are declared as `interface`, matching this codebase's
			// existing convention (37 interfaces vs. 12 type aliases already, the
			// latter reserved for unions/mapped/utility types an interface can't
			// express). Method-shorthand signatures in an interface are unsoundly
			// bivariant on their parameter types in TypeScript; the property-style
			// arrow-function form is checked contravariantly like every other
			// function type -- this is a real Liskov-substitution soundness gap
			// method shorthand has and property syntax doesn't, not a preference.
			"@typescript-eslint/consistent-type-definitions": ["error", "interface"],
			"@typescript-eslint/method-signature-style": ["error", "property"],
			"@typescript-eslint/adjacent-overload-signatures": "error",

			// ── Immutability: makes an accidental mutation a caught bug, not a
			// runtime surprise. Scoped to class members (this codebase has one
			// class, SessionGraph) rather than adopting eslint-plugin-functional's
			// full immutable-data ruleset, which also bans plain object/array
			// mutation project-wide -- too disruptive to justify here today.
			"@typescript-eslint/prefer-readonly": "error",

			// ── SRP signal: a class with only static members should be a module
			// of plain functions instead -- it isn't carrying instance state, so
			// the class wrapper is adding indirection without adding a reason to
			// exist.
			"@typescript-eslint/no-extraneous-class": "error",
		},
	},

	// Import graph hygiene: a cycle is nearly always a Dependency-Inversion
	// violation in disguise -- two modules that each need something from the
	// other have no clean high-level/low-level split left. Same rule and
	// maxDepth alef's own eslint.config.ts uses.
	{
		files: ["src/**/*.{ts,tsx}"],
		plugins: { "import-x": importX },
		settings: {
			"import-x/resolver": {
				typescript: { project: "./tsconfig.json" },
			},
		},
		rules: {
			"import-x/no-cycle": ["error", { maxDepth: 3, ignoreExternal: true }],
		},
	},

	// SonarJS: code-smell/maintainability rules ESLint core and
	// typescript-eslint don't cover -- cognitive complexity, duplicated
	// branches/literals/functions, collapsible conditionals. These are all
	// signals a function or module is doing more than one job, the same
	// thing Single Responsibility is checking for, just measured
	// structurally instead of by reading a docstring. Scoped off test files:
	// repeated near-identical `expect(...)` setups across cases are
	// intentional there, not duplication to fix.
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["**/*.test.{ts,tsx}"],
		extends: [sonarjs.configs.recommended],
	},

	// Domain purity: Workspace/Conversation/graph/ingest core stays framework-neutral.
	{
		files: DOMAIN_FILES,
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "react", message: "Domain files must stay framework-neutral." },
						{ name: "react-dom", message: "Domain files must stay framework-neutral." },
					],
				},
			],
			"no-restricted-globals": ["error", ...RESTRICTED_GLOBALS],
		},
	},

	// Adapter allowlist: only the files above may reach a browser/fetch global directly.
	{
		files: ["src/**/*.{ts,tsx}"],
		ignores: [...ADAPTER_ALLOWLIST, "**/*.test.{ts,tsx}"],
		rules: {
			"no-restricted-globals": ["error", ...RESTRICTED_GLOBALS],
		},
	},

	// commands/react.tsx is a deliberate Context + Provider + hook module
	// (CommandEnvironmentContext, CommandProvider, useCommandEnvironment,
	// CommandButton, useCommandShortcut) -- the canonical case teams scope
	// this rule away from, since a hook and the component that provides its
	// context are meant to live together, not be split across files just to
	// satisfy Fast Refresh.
	{
		files: ["src/commands/react.tsx"],
		rules: {
			"react-refresh/only-export-components": "off",
		},
	},

	// Node-side build/check scripts: plain JS, no React.
	{
		files: ["scripts/**/*.mjs"],
		extends: [js.configs.recommended],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
			globals: globals.node,
		},
	},

	// Config files, node-side script tests, and Playwright specs run under Node.
	{
		files: ["*.config.{ts,js}", "system/**/*.ts", "scripts/**/*.test.ts"],
		extends: [js.configs.recommended, tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2022,
			globals: { ...globals.node, ...globals.browser },
		},
	},
);
