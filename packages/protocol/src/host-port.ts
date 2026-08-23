import { z } from "zod";

/**
 * Host capability inventory (Electron threat-model decision, task
 * "Define React host ports, Electron process ownership, and IPC threat
 * model"). Every browser global or native capability Zodiac's React code
 * touches -- or could plausibly touch next -- is classified exactly once
 * here, so a reviewer never has to re-derive "does this need a host port"
 * from scratch for a new file.
 *
 * - "web-standard": a real Web Platform API (fetch, EventSource, WebSocket,
 *   localStorage, matchMedia, pointer events, Notification). Chromium's
 *   renderer process exposes the full Web Platform surface identically
 *   whether `nodeIntegration`/`contextIsolation`/`sandbox` are on or off --
 *   those flags gate Node/Electron privilege, not Web APIs. Verified against
 *   this repo's own real adapter files (theme.ts, preferences.ts,
 *   shape-settings-style.ts, useResizeHandle.ts, conversation/client.ts,
 *   pi/client.ts, terminal/terminal-client.ts): every one of them already
 *   only calls a web-standard API. None of them need an Electron-specific
 *   implementation, a `HostPort` abstraction, or an `isElectron` branch --
 *   the existing ESLint `ADAPTER_ALLOWLIST` in apps/web/eslint.config.js is
 *   already the enforced boundary for these, and it stays exactly as-is.
 * - "host-port": something only a *host* (the composition root: apps/web's
 *   `main.tsx`/`App.tsx`, apps/desktop's future equivalent) can supply,
 *   because it differs by host and no Web Platform API covers it.
 * - "zodiacd-api": not a client-side capability at all -- a real HTTP/SSE
 *   call to zodiacd, unrelated to which shell renders the response.
 * - "rejected": not used anywhere in this codebase today. Listed so a
 *   reviewer sees it was considered, not silently missed. Do not add real
 *   code against a "rejected" capability without updating this table first.
 */
export type HostCapabilityClassification = "web-standard" | "host-port" | "zodiacd-api" | "rejected";

export interface HostCapabilityInventoryEntry {
	readonly capability: string;
	readonly classification: HostCapabilityClassification;
	readonly rationale: string;
}

export const HOST_CAPABILITY_INVENTORY: readonly HostCapabilityInventoryEntry[] = [
	{
		capability: "localStorage (Preferences, ThemeController)",
		classification: "web-standard",
		rationale: "Real per-origin storage in every Electron renderer, with contextIsolation/sandbox on. createPreferences/createThemeController already take an injected Storage, unchanged for Electron.",
	},
	{
		capability: "matchMedia (ThemeController's prefers-color-scheme)",
		classification: "web-standard",
		rationale: "Standard CSSOM View API, present in Chromium's renderer regardless of Electron privilege flags.",
	},
	{
		capability: "document.documentElement.style / classList (ThemeController, ShapeSettingsStyleTarget)",
		classification: "web-standard",
		rationale: "Plain DOM API against the renderer's own document; no Node/Electron dependency.",
	},
	{
		capability: "window.addEventListener('pointermove'/'pointerup') (useResizeHandle)",
		classification: "web-standard",
		rationale: "Standard Pointer Events API. Needed on `window` rather than the handle element because a drag routinely leaves the handle's own small hit area -- true in Electron's renderer exactly as in a browser tab.",
	},
	{
		capability: "fetch / EventSource (ConversationClient, PiClient)",
		classification: "web-standard",
		rationale: "Both are real Web Platform APIs available to a sandboxed renderer; a same-origin/explicit-origin loopback fetch to zodiacd needs no Node networking stack.",
	},
	{
		capability: "WebSocket (TerminalClient)",
		classification: "web-standard",
		rationale: "Standard WebSocket API; unaffected by contextIsolation/sandbox/nodeIntegration.",
	},
	{
		capability: "zodiacd base URL resolution (apps/web/src/platform/zodiacd-config.ts)",
		classification: "host-port",
		rationale:
			"Web resolves this at build time from `import.meta.env` (a separately tracked task, 'Inject runtime client configuration at app bootstrap', is already replacing that with an explicit bootstrap value for both hosts). Electron cannot use a Vite build-time env var the same way -- the desktop main process is the one process that can locate/spawn zodiacd and knows its real port. This is the one real host-port capability this codebase needs today; see DesktopHostPort below.",
	},
	{
		capability: "Vehicle bearer tokens / zodiacd session credentials",
		classification: "host-port",
		rationale:
			"Never a renderer-visible value in either host -- Web already keeps these server-side per the existing 'Vehicle bearer tokens must never reach browser-visible JavaScript' invariant. For Electron this means main/preload must not forward a raw token across the IPC boundary either; the renderer only ever receives already-scoped, already-authorized response bodies, exactly as Web's browser tab does today.",
	},
	{
		capability: "window.open / target=_blank external links",
		classification: "rejected",
		rationale:
			"Not called anywhere in apps/web/src today (verified: zero matches). If a future feature adds one, it must not reach the renderer as a raw `window.open` call -- Electron's main process must install `setWindowOpenHandler` denying all in-app window creation and routing an explicit external-link capability through `shell.openExternal` instead, matching the existing 'no forked component tree, no second logical World' security posture. Flagged here so that future feature doesn't quietly reopen this instead of using a capability.",
	},
	{
		capability: "Native window chrome (minimize/maximize/close, custom title bar)",
		classification: "rejected",
		rationale: "Zodiac Desktop v1 uses default OS chrome (no frameless-window decision has been made). Revisit only if a frameless design is actually adopted -- do not build this speculatively.",
	},
	{
		capability: "Native file dialogs, OS notifications beyond the Web Notification API, clipboard beyond navigator.clipboard, auto-update status",
		classification: "rejected",
		rationale: "No current Zodiac feature calls any of these. Each is real future host-port surface if and when a feature needs it, not before.",
	},
];

/**
 * Electron-only capability extension. Deliberately minimal: per the
 * inventory above, exactly one capability exists today that a Web Platform
 * API cannot provide and that differs meaningfully by host. Web's own
 * composition root never implements this interface and never needs a stub
 * for it -- `apps/web/src/platform/zodiacd-config.ts`'s existing
 * `resolveZodiacdBaseUrl` free function is Web's whole answer. Only
 * `apps/desktop`'s future renderer composition root receives a
 * `DesktopHostPort`, injected once, the same dependency direction every
 * other port in this codebase already follows (shared code depends inward
 * on a typed interface; a concrete host adapter depends outward on it, and
 * a host adapter is never imported by shared code, only by its own
 * composition root).
 */
export interface DesktopHostPort {
	/** Resolves the local zodiacd base URL to fetch/connect against. Never returns a credential -- only a scheme+host+port. */
	resolveZodiacdBaseUrl: () => Promise<string>;
}

/**
 * IPC ownership and shape for `DesktopHostPort`, once Electron's shell
 * exists (contained in "Build a sandboxed Electron shell with a typed
 * preload bridge and packaged local renderer").
 *
 * - **Main** owns the real answer (reads local daemon state, e.g. a lock
 *   file/port announcement, or spawns zodiacd) and is the only process
 *   trusted to produce it.
 * - **Preload** exposes exactly one typed method (`resolveZodiacdBaseUrl`)
 *   built on `contextBridge.exposeInMainWorld`, never a raw `ipcRenderer`
 *   passthrough -- a renderer script can only call the named method, never
 *   send an arbitrary IPC channel/payload of its own choosing.
 * - **Renderer** sees only the `DesktopHostPort` interface above; it holds
 *   no Electron/Node import.
 * - **zodiacd** is not part of this IPC hop at all -- it's what the
 *   resolved base URL subsequently points the existing fetch/EventSource/
 *   WebSocket adapters at.
 *
 * Every request/result crossing this boundary is validated against the zod
 * schemas below on both sides (structured-clone-safe: plain strings/booleans
 * only, no functions/class instances). `main` additionally validates
 * `event.senderFrame` is the app's own packaged renderer before answering
 * (per Electron's current IPC security guidance) -- rejecting any other
 * frame/origin outright rather than trusting `ipcRenderer`'s sender by
 * default. Every request carries a bounded `requestId` for correlation and
 * cancellation; there is no unbounded/streaming subscription for this one
 * capability, so no dispose lifecycle is needed for it specifically (a
 * future subscription-shaped capability must define its own explicit
 * dispose channel, matching the bounded reconnect-lifecycle discipline this
 * codebase already applies to World/notification/agent/terminal clients).
 */
export const DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL = "zodiac:desktop.resolveZodiacdBaseUrl";

export const DesktopIpcRequestSchema = z.object({
	channel: z.literal(DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL),
	requestId: z.string().min(1).max(128),
});
export type DesktopIpcRequest = z.infer<typeof DesktopIpcRequestSchema>;

export const DesktopIpcFailureReasonSchema = z.enum(["daemon-unreachable", "invalid-config", "timeout"]);
export type DesktopIpcFailureReason = z.infer<typeof DesktopIpcFailureReasonSchema>;

export const DesktopIpcResultSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), requestId: z.string().min(1).max(128), baseUrl: z.string().url() }),
	z.object({ ok: z.literal(false), requestId: z.string().min(1).max(128), reason: DesktopIpcFailureReasonSchema, message: z.string().max(500) }),
]);
export type DesktopIpcResult = z.infer<typeof DesktopIpcResultSchema>;
