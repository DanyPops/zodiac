/** Matches apps/service's own DEFAULT_PORT/DEFAULT_HOST (parse-args.ts) -- the daemon a fresh `npm run zodiacd` boots without any flags. */
export const DEFAULT_ZODIACD_BASE_URL = "http://127.0.0.1:4390";

/**
 * Where the browser reaches a running zodiacd instance -- the one thing
 * that changed once apps/web stopped being its own backend (zodiacd stages
 * 1-3) and became a real HTTP client of a standalone daemon (stage 4).
 * Overridable via VITE_ZODIACD_URL (a real Vite build-time env var, e.g. in
 * a deployed environment where the daemon isn't on localhost:4390) for
 * environments other than "developer machine, daemon running locally."
 */
export function resolveZodiacdBaseUrl(env: Record<string, string | undefined> = import.meta.env): string {
	return env.VITE_ZODIACD_URL ?? DEFAULT_ZODIACD_BASE_URL;
}
