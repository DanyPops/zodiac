export interface ZodiacTuiArgs {
	/** The positional path argument (a file or directory to open), or undefined if none was given -- identical to today's bare `process.argv[2]` once --daemon has been scanned out. */
	readonly path: string | undefined;
	/**
	 * A real, already-running zodiacd instance to attach to instead of this
	 * process's own embedded WorldStore/agent session (zodiacd stage 5).
	 * Absent means today's unchanged fully-embedded mode -- no daemon probe,
	 * no network call, zero behavior change for a zero-dependency
	 * `zodiac-tui` in an empty directory. --daemon <url> overrides
	 * ZODIAC_DAEMON_URL, which overrides no attach at all.
	 */
	readonly daemonUrl: string | undefined;
}

/**
 * Minimal, dependency-free CLI arg parsing for apps/terminal -- mirrors
 * apps/service's own parseZodiacdArgs (env overridden by an explicit flag).
 * Deliberately additive to the pre-existing bare-positional-argument
 * contract (classifyPath(process.argv[2]) before this file existed): a
 * caller with no --daemon anywhere still gets exactly the same `path` value
 * classifyPath itself would have seen.
 */
export function parseTerminalArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): ZodiacTuiArgs {
	let daemonUrl = env.ZODIAC_DAEMON_URL;
	const positionals: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--daemon") daemonUrl = argv[++i];
		else positionals.push(arg!);
	}

	return { path: positionals[0], daemonUrl };
}
