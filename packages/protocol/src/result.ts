import type { z } from "zod";

/**
 * The outcome of validating something that came from outside this process's
 * own control -- a persisted snapshot, a network payload, a package
 * contribution manifest. Never throws: a caller branches on `ok` instead of
 * wrapping every parse in try/catch, and a schema failure is exactly as
 * "expected" a result as success is.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: readonly string[] };

/** Bounds how many issues a single failed parse reports -- an adversarial or badly-shaped payload can otherwise produce an unbounded issue list. */
const MAX_REPORTED_ISSUES = 20;

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
	const result = schema.safeParse(input);
	if (result.success) return { ok: true, value: result.data };
	const issues = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`);
	return { ok: false, issues };
}
