// @ts-check
import path from "node:path";

// The "must-call" half of the cue registration primitive's own enforcement
// plan (packages/ui/src/cues.ts). apps/web/eslint.config.js's existing
// ADAPTER_ALLOWLIST/no-restricted-globals bans a global's *presence* --
// this is the opposite shape (a file must *contain* a call), which has no
// built-in ESLint rule to configure. A genuinely custom AST rule instead.

/** Default filename substrings identifying a real content-hosting file (a gallery tile grid, a dockable Surface) as opposed to pure layout/chrome. */
const DEFAULT_INCLUDES = ["Surface", "Gallery"];

/** @type {import("eslint").Rule.RuleModule} */
export const requireCueRegistration = {
	meta: {
		type: "problem",
		docs: {
			description: "Requires a Surface/Gallery content file to call registerCue(...) somewhere, unless explicitly allowlisted as chrome-only.",
		},
		schema: [
			{
				type: "object",
				properties: {
					includes: { type: "array", items: { type: "string" } },
					allowlist: { type: "array", items: { type: "string" } },
				},
				additionalProperties: false,
			},
		],
		messages: {
			missingRegistration:
				"This file's name matches a Surface/Gallery content glob but never calls registerCue(...) anywhere in it. Register a real cue at the same call site the component's own real action already lives (mirrors packages/ui/src/cues.ts's own \"no separate hand-maintained list\" discipline), or add this file to the rule's explicit allowlist if it's genuinely chrome-only with nothing to register.",
		},
	},
	create(context) {
		const options = context.options[0] ?? {};
		const includes = /** @type {readonly string[]} */ (options.includes ?? DEFAULT_INCLUDES);
		const allowlist = /** @type {readonly string[]} */ (options.allowlist ?? []);
		const filename = context.filename ?? context.getFilename();
		const basename = path.basename(filename);

		const matchesContentGlob = basename.endsWith(".tsx") && includes.some((token) => basename.includes(token));
		const isAllowlisted = allowlist.some((entry) => filename.endsWith(entry));
		if (!matchesContentGlob || isAllowlisted) return {};

		let registered = false;
		return {
			CallExpression(node) {
				if (node.callee.type === "Identifier" && node.callee.name === "registerCue") registered = true;
			},
			"Program:exit"(node) {
				if (!registered) context.report({ node, messageId: "missingRegistration" });
			},
		};
	},
};
