/**
 * The explicit-allowlist replacement for `server.ts`'s former reflective
 * CORS (any request `Origin` was mirrored straight back into
 * `Access-Control-Allow-Origin`, which is not authentication and does not
 * stop a malicious page's own request from executing server-side -- CORS
 * only ever gates whether *that page's own script* may read the response).
 * `origin === undefined` means the caller never sent an `Origin` header at
 * all, true of every real non-browser HTTP/WebSocket client (Node's
 * `fetch`/`ws`, a future Electron main-process request, this app's own
 * Terminal client): browsers are the one client class that always sends
 * `Origin` on a cross-origin request, so its absence is itself real signal,
 * not something to spoof-guard against here -- a request already reached
 * this process only because it's loopback-bound in the first place.
 */
export interface OriginPolicy {
	isAllowed: (origin: string | undefined) => boolean;
}

/** `allowedOrigins` are exact, case-sensitive scheme+host+port strings, e.g. "http://127.0.0.1:5173" -- no wildcard, no suffix/prefix matching. */
export function createOriginPolicy(allowedOrigins: readonly string[]): OriginPolicy {
	const allowed = new Set(allowedOrigins);
	return {
		isAllowed(origin) {
			if (origin === undefined) return true;
			return allowed.has(origin);
		},
	};
}
