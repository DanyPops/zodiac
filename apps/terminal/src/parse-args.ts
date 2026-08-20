export type ZodiacTuiMode = "monolith" | "local-server" | "remote";

const VALID_MODES: readonly ZodiacTuiMode[] = ["monolith", "local-server", "remote"];

function isZodiacTuiMode(value: string): value is ZodiacTuiMode {
	return (VALID_MODES as readonly string[]).includes(value);
}

export interface ZodiacTuiArgs {
	/** The positional path argument (a file or directory to open), or undefined if none was given -- identical to today's bare `process.argv[2]` once --daemon/--mode have been scanned out. */
	readonly path: string | undefined;
	/**
	 * Which World/governance backing this process uses -- an explicit,
	 * up-front choice, never a fallback discovered after a failed connection
	 * attempt (see the "apps/terminal: explicit mode selection" Papyrus
	 * Task's own root-cause finding: a silent Remote-to-embedded downgrade
	 * produced two structurally different trust postures for the same chat
	 * feature, selected by network luck).
	 *
	 * Resolution order: an explicit `--mode` flag always wins. Otherwise, a
	 * daemon URL present at all (via `--daemon` or `ZODIAC_DAEMON_URL`)
	 * implies `"remote"` -- the same single-flag ergonomics as before, but
	 * `"remote"` itself no longer degrades silently on failure (see cli.ts's
	 * own `attachToDaemon`). With no `--mode` and no daemon URL anywhere,
	 * resolves to `"monolith"` -- unchanged zero-dependency default behavior.
	 */
	readonly mode: ZodiacTuiMode;
	/**
	 * A real, already-running zodiacd instance to attach to -- required for
	 * `"remote"` mode (a missing value is this function's own caller's
	 * problem to reject, not this parser's). Ignored for `"local-server"`
	 * (that mode spawns and discovers its own URL) and `"monolith"` (no
	 * daemon at all).
	 */
	readonly daemonUrl: string | undefined;
}

/**
 * Minimal, dependency-free CLI arg parsing for apps/terminal -- mirrors
 * apps/service's own parseZodiacdArgs (env overridden by an explicit flag).
 * Deliberately additive to the pre-existing bare-positional-argument
 * contract (classifyPath(process.argv[2]) before this file existed): a
 * caller with no --daemon/--mode anywhere still gets exactly the same
 * `path` value classifyPath itself would have seen.
 */
export function parseTerminalArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): ZodiacTuiArgs {
	let daemonUrl = env.ZODIAC_DAEMON_URL;
	let explicitMode: ZodiacTuiMode | undefined;
	const positionals: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--daemon") daemonUrl = argv[++i];
		else if (arg === "--mode") {
			const value = argv[++i];
			if (value === undefined || !isZodiacTuiMode(value)) {
				throw new Error(`--mode must be one of ${VALID_MODES.join(", ")} (got ${JSON.stringify(value)})`);
			}
			explicitMode = value;
		} else positionals.push(arg!);
	}

	const mode: ZodiacTuiMode = explicitMode ?? (daemonUrl ? "remote" : "monolith");
	return { path: positionals[0], mode, daemonUrl };
}
