/**
 * Zodiac's own bounded vocabulary for a live Pi conversation -- what a
 * renderer (Web's Footer chat, the TUI's Footer region, a future test) needs
 * to project a conversation, deliberately smaller than Pi's own internal
 * AgentSessionEvent family (agent_start, message_start/update/end,
 * turn_start/end, tool_execution_start/update/end, compaction_*,
 * auto_retry_*, queue_update, entry_appended, session_info_changed,
 * thinking_level_changed, summarization_retry_*, bash_execution_update --
 * ~20 variants). Both InProcessAgentIntegration and SubprocessAgentIntegration
 * (@zodiac/pi) translate down to this same, smaller type so a caller never
 * has to know which adapter is live behind the port.
 */
import { z } from "zod";

export type ZodiacAgentEvent =
	| { readonly type: "agent-start" }
	| { readonly type: "agent-settled" }
	| { readonly type: "assistant-message-start" }
	/** A streaming text delta for the in-progress assistant message. */
	| { readonly type: "assistant-message-delta"; readonly text: string }
	/** The assistant message's final, complete text. */
	| { readonly type: "assistant-message-end"; readonly text: string }
	| { readonly type: "turn-start" }
	| { readonly type: "turn-end" }
	| { readonly type: "tool-call-start"; readonly toolCallId: string; readonly toolName: string; readonly input: unknown }
	/** Accumulated live output for a still-running tool call; consumers replace rather than append. */
	| { readonly type: "tool-call-update"; readonly toolCallId: string; readonly toolName: string; readonly output: unknown }
	| { readonly type: "tool-call-end"; readonly toolCallId: string; readonly toolName: string; readonly output: unknown; readonly isError: boolean }
	| { readonly type: "compaction-start"; readonly reason: "manual" | "threshold" | "overflow" }
	| { readonly type: "compaction-end"; readonly reason: "manual" | "threshold" | "overflow"; readonly aborted: boolean; readonly errorMessage?: string }
	| { readonly type: "session-info-changed"; readonly name?: string }
	| { readonly type: "error"; readonly message: string };

/**
 * The real runtime boundary `isZodiacAgentEvent` alone doesn't provide --
 * that function narrows on `type` being a recognized string only, not
 * per-variant field shapes (e.g. a "tool-call-start" frame missing
 * `toolCallId`/`toolName` still passes it). This schema validates the full
 * shape of every variant, matching the union above field-for-field.
 * `input`/`output` stay `z.unknown()` deliberately -- a tool call's own
 * payload is genuinely caller-defined, not something this port constrains.
 */
export const ZodiacAgentEventSchema: z.ZodType<ZodiacAgentEvent> = z.discriminatedUnion("type", [
	z.object({ type: z.literal("agent-start") }),
	z.object({ type: z.literal("agent-settled") }),
	z.object({ type: z.literal("assistant-message-start") }),
	z.object({ type: z.literal("assistant-message-delta"), text: z.string() }),
	z.object({ type: z.literal("assistant-message-end"), text: z.string() }),
	z.object({ type: z.literal("turn-start") }),
	z.object({ type: z.literal("turn-end") }),
	z.object({ type: z.literal("tool-call-start"), toolCallId: z.string().min(1).max(200), toolName: z.string().min(1).max(200), input: z.unknown() }),
	z.object({ type: z.literal("tool-call-update"), toolCallId: z.string().min(1).max(200), toolName: z.string().min(1).max(200), output: z.unknown() }),
	z.object({ type: z.literal("tool-call-end"), toolCallId: z.string().min(1).max(200), toolName: z.string().min(1).max(200), output: z.unknown(), isError: z.boolean() }),
	z.object({ type: z.literal("compaction-start"), reason: z.enum(["manual", "threshold", "overflow"]) }),
	z.object({ type: z.literal("compaction-end"), reason: z.enum(["manual", "threshold", "overflow"]), aborted: z.boolean(), errorMessage: z.string().max(2000).optional() }),
	z.object({ type: z.literal("session-info-changed"), name: z.string().max(500).optional() }),
	z.object({ type: z.literal("error"), message: z.string().max(2000) }),
]);

export type AgentSessionControlFailureReason = "unsupported" | "model-not-found" | "cancelled" | "failed";
export type AgentSessionControlOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: AgentSessionControlFailureReason; readonly message: string };

/** The wire-boundary validator for AgentSessionControlOutcome -- replaces a bare `as AgentSessionControlOutcome` cast on daemon JSON (apps/web's PiClient.setModel/compact/resume/fork). */
export const AgentSessionControlOutcomeSchema: z.ZodType<AgentSessionControlOutcome> = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true) }),
	z.object({ ok: z.literal(false), reason: z.enum(["unsupported", "model-not-found", "cancelled", "failed"]), message: z.string().max(2000) }),
]);

/** Bounded session operations shared by embedded, subprocess, and HTTP adapters. */
export interface AgentSessionControlPort {
	setModel: (provider: string, modelId: string) => Promise<AgentSessionControlOutcome>;
	compact: (customInstructions?: string) => Promise<AgentSessionControlOutcome>;
	resume: (sessionPath: string) => Promise<AgentSessionControlOutcome>;
	fork: (entryId: string) => Promise<AgentSessionControlOutcome>;
}

/**
 * The driven half of a Pi Agent Integration: what Zodiac needs to send a
 * prompt to a live agent and observe its conversation, independent of
 * whether that agent lives in-process (InProcessAgentIntegration) or as a
 * subprocess speaking pi's RPC protocol (SubprocessAgentIntegration) -- both
 * live in @zodiac/pi. Both adapters implement this exact shape -- a caller
 * depends on this interface, never on either concrete adapter. This package
 * (@zodiac/agent) is deliberately the one place that stays Pi-SDK-neutral:
 * it has no dependency on @earendil-works/pi-coding-agent or
 * @danypops/pi-rpc-protocol, only plain types -- a caller that only needs to
 * hold/pass around a port reference never pulls in either Pi SDK.
 *
 * Deliberately excludes the driving half (Pi's own tools calling back into
 * Zodiac through an authorized command port) -- that half depends on
 * Walking skeleton story 7's caller-parity work and is out of scope here.
 */
export interface AgentIntegrationPort {
	/** Sends a prompt. Rejects if the agent is already streaming and a queued alternative (steer/followUp) is more appropriate. */
	prompt: (text: string) => Promise<void>;
	/** Queues a message for delivery after the current assistant turn's tool calls finish, ahead of the next LLM call. */
	steer: (text: string) => Promise<void>;
	/** Queues a message for delivery only once the agent has fully settled. */
	followUp: (text: string) => Promise<void>;
	/** Aborts the current run, if any. */
	abort: () => Promise<void>;
	/** Present on every in-tree adapter; optional preserves compatibility for third-party v1 adapters during the additive protocol transition. */
	readonly session?: AgentSessionControlPort;
	onEvent: (listener: (event: ZodiacAgentEvent) => void) => () => void;
	/** Fires once if the underlying integration ends unexpectedly (a subprocess exiting; never fires for the in-process adapter, which has no separate process to exit). */
	onExit: (listener: (reason: string | undefined) => void) => () => void;
	dispose: () => void;
}

/** Exhaustiveness guard for callers translating a value this package doesn't already recognize -- never actually reachable at runtime for a well-typed caller. */
export function assertNeverZodiacAgentEvent(event: never): never {
	throw new Error(`Unhandled ZodiacAgentEvent: ${JSON.stringify(event)}`);
}

/**
 * This port's own overall version. Bumped only when a new ZodiacAgentEvent
 * variant is added or an existing one's fields change in a way an older
 * consumer couldn't safely ignore. Append-only, same discipline as
 * commands.ts's COMMAND_INTENT_PROTOCOL_VERSION: an existing variant's
 * recorded ZODIAC_AGENT_EVENT_MIN_VERSION entry never changes after release.
 */
export const ZODIAC_AGENT_EVENT_PROTOCOL_VERSION = 2;

/**
 * The minimum ZODIAC_AGENT_EVENT_PROTOCOL_VERSION a consumer must declare
 * support for to safely handle each ZodiacAgentEvent variant. Every variant
 * shipped so far was introduced at version 1.
 */
export const ZODIAC_AGENT_EVENT_MIN_VERSION: Readonly<Record<ZodiacAgentEvent["type"], number>> = {
	"agent-start": 1,
	"agent-settled": 1,
	"assistant-message-start": 1,
	"assistant-message-delta": 1,
	"assistant-message-end": 1,
	"turn-start": 2,
	"turn-end": 2,
	"tool-call-start": 1,
	"tool-call-update": 2,
	"tool-call-end": 1,
	"compaction-start": 2,
	"compaction-end": 2,
	"session-info-changed": 2,
	error: 1,
};

/**
 * True when a consumer declaring support up to `supportedVersion` can safely
 * handle the given event. False means "skip/degrade this event, don't
 * project it into a UI it wasn't built to render" -- e.g. a future
 * apps/web PiClient talking to an already-upgraded zodiacd across a
 * deploy skew window. Both in-tree adapters (InProcessAgentIntegration,
 * SubprocessAgentIntegration) and every in-tree consumer ship in lockstep
 * with this port today, so this is a no-op for them; it exists for that
 * cross-version window, not a currently-exercised real gap.
 */
export function isSupportedZodiacAgentEvent(event: ZodiacAgentEvent, supportedVersion: number): boolean {
	return ZODIAC_AGENT_EVENT_MIN_VERSION[event.type] <= supportedVersion;
}

/**
 * Narrows an unknown, already-JSON-parsed SSE frame payload to a real
 * ZodiacAgentEvent -- shared by every HTTP+SSE consumer of zodiacd's
 * `/api/agent/sessions/:id/events` wire format (apps/web's PiClient and
 * @zodiac/pi's HttpAgentIntegration) so the exact same "a session-exited
 * frame isn't one of these" rule lives in exactly one place, not
 * re-implemented per adapter and left to drift.
 */
const ZODIAC_AGENT_EVENT_TYPES: ReadonlySet<ZodiacAgentEvent["type"]> = new Set(Object.keys(ZODIAC_AGENT_EVENT_MIN_VERSION) as ZodiacAgentEvent["type"][]);

export function isZodiacAgentEvent(value: unknown): value is ZodiacAgentEvent {
	if (typeof value !== "object" || value === null || !("type" in value) || typeof value.type !== "string") return false;
	return ZODIAC_AGENT_EVENT_TYPES.has(value.type as ZodiacAgentEvent["type"]);
}
