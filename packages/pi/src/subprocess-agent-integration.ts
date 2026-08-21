import { resolveZodiacAgentDir, seedZodiacAuthOnce } from "@zodiac/server/pi-agent-dir";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { encodeRpcCommand, extractMessageText, parseRpcLine, type PiRpcEvent } from "@danypops/pi-rpc-protocol";
import type { AgentIntegrationPort, AgentSessionControlOutcome, ZodiacAgentEvent } from "@zodiac/agent";

const DEFAULT_COMMAND = ["pi", "--mode", "rpc", "--no-session"] as const;

/** Bounds how much stderr this adapter retains for diagnostics -- a real crash's error text is useful, an unbounded buffer of a runaway process's output is not. */
const MAX_STDERR_CHARS = 8_000;
const MAX_PENDING_SESSION_COMMANDS = 64;
const SESSION_COMMAND_TIMEOUT_MS = 10_000;

export interface SubprocessAgentIntegrationOptions {
	/** Defaults to `pi --mode rpc --no-session`. Overridden by tests (a fixture stand-in process) and by callers needing extra CLI flags. */
	readonly command?: readonly string[];
	readonly cwd?: string;
	/**
	 * Zodiac's own namespaced Pi config/extension/session/auth directory --
	 * propagated to the spawned `pi` process via PI_CODING_AGENT_DIR, kept in
	 * parity with apps/web/src/pi/process-rpc-session.ts (this adapter's
	 * own doc comment notes it was ported from that file). Defaults to
	 * resolveZodiacAgentDir(); injectable for hermetic tests.
	 */
	readonly agentDir?: string;
	/** Where a one-time auth.json seed is copied from. Defaults to the user's real ~/.pi/agent. */
	readonly sourceAgentDir?: string;
}

/**
 * The documented external-process fallback (story 8's own words): spawns a
 * real `pi --mode rpc` child process and speaks its JSONL wire protocol,
 * translating PiRpcEvent down to the exact same ZodiacAgentEvent type
 * InProcessAgentIntegration produces -- a caller behind AgentIntegrationPort
 * cannot tell which adapter it's holding.
 *
 * Ported from apps/web/src/pi/process-rpc-session.ts, which already
 * proved this spawn/framing approach works end to end (see that file's own
 * tests and the live multi-instance smoke test run against it). This
 * version additionally translates events to Zodiac's bounded vocabulary
 * instead of leaving that to each caller.
 *
 * Uses Pi's current distinct prompt/steer/follow_up RPC commands. The
 * compatibility encoder dependency predates steer/follow_up, so those two
 * additive commands are encoded locally as the same bounded JSONL records
 * documented by Pi rather than degraded to plain prompts.
 */
export function createSubprocessAgentIntegration(options: SubprocessAgentIntegrationOptions = {}): AgentIntegrationPort {
	const [command = DEFAULT_COMMAND[0], ...args] = options.command ?? DEFAULT_COMMAND;
	const agentDir = options.agentDir ?? resolveZodiacAgentDir();
	seedZodiacAuthOnce({ agentDir, sourceAgentDir: options.sourceAgentDir ?? join(homedir(), ".pi", "agent") });
	const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(command, args, {
		cwd: options.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});

	const eventListeners = new Set<(event: ZodiacAgentEvent) => void>();
	const exitListeners = new Set<(reason: string | undefined) => void>();
	const pendingSessionCommands = new Map<string, { resolve: (outcome: AgentSessionControlOutcome) => void; timer: ReturnType<typeof setTimeout> }>();
	let nextSessionCommandId = 0;
	let stderr = "";

	function emit(event: ZodiacAgentEvent): void {
		for (const listener of eventListeners) listener(event);
	}

	function translateUnknown(raw: unknown): ZodiacAgentEvent | undefined {
		if (!raw || typeof raw !== "object") return undefined;
		const value = raw as Record<string, unknown>;
		switch (value.type) {
			case "turn_start":
				return { type: "turn-start" };
			case "turn_end":
				return { type: "turn-end" };
			case "tool_execution_update":
				return typeof value.toolCallId === "string" && typeof value.toolName === "string" ? { type: "tool-call-update", toolCallId: value.toolCallId, toolName: value.toolName, output: value.partialResult } : undefined;
			case "compaction_start":
				return value.reason === "manual" || value.reason === "threshold" || value.reason === "overflow" ? { type: "compaction-start", reason: value.reason } : undefined;
			case "compaction_end":
				return value.reason === "manual" || value.reason === "threshold" || value.reason === "overflow" ? { type: "compaction-end", reason: value.reason, aborted: value.aborted === true, ...(typeof value.errorMessage === "string" ? { errorMessage: value.errorMessage } : {}) } : undefined;
			case "session_info_changed":
				return { type: "session-info-changed", ...(typeof value.name === "string" ? { name: value.name } : {}) };
			default:
				return undefined;
		}
	}

	/** Exhaustive over PiRpcEvent's own variants; unknown valid upstream events are narrowed by translateUnknown so this adapter can bridge protocol additions ahead of the compatibility parser package. */
	function translate(event: PiRpcEvent): ZodiacAgentEvent | undefined {
		switch (event.type) {
			case "agent_start":
				return { type: "agent-start" };
			case "agent_settled":
				return { type: "agent-settled" };
			case "agent_end":
				return undefined;
			case "message_start":
				return event.message.role === "assistant" ? { type: "assistant-message-start" } : undefined;
			case "message_update":
				return event.delta ? { type: "assistant-message-delta", text: event.delta.text } : undefined;
			case "message_end":
				return event.message.role === "assistant" ? { type: "assistant-message-end", text: extractMessageText(event.message) } : undefined;
			case "tool_execution_start":
				return { type: "tool-call-start", toolCallId: event.toolCallId, toolName: event.toolName, input: event.args };
			case "tool_execution_end":
				return { type: "tool-call-end", toolCallId: event.toolCallId, toolName: event.toolName, output: event.result, isError: event.isError };
			case "response":
				return event.success ? undefined : { type: "error", message: event.error ?? `pi rejected command "${event.command}"` };
			case "extension_ui_request":
				return undefined;
			case "unknown-event":
				return translateUnknown(event.raw);
			default:
				return assertNeverPiRpcEvent(event);
		}
	}

	const decoder = new StringDecoder("utf8");
	let buffer = "";
	child.stdout.on("data", (chunk: Buffer) => {
		buffer += decoder.write(chunk);
		let index: number;
		while ((index = buffer.indexOf("\n")) !== -1) {
			let line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line) continue;
			let raw: unknown;
			try {
				raw = JSON.parse(line);
			} catch {
				raw = undefined;
			}
			const response = raw as { type?: unknown; id?: unknown; success?: unknown; error?: unknown } | undefined;
			if (response?.type === "response" && typeof response.id === "string") {
				const pending = pendingSessionCommands.get(response.id);
				if (pending) {
					clearTimeout(pending.timer);
					pendingSessionCommands.delete(response.id);
					pending.resolve(response.success === true ? { ok: true } : { ok: false, reason: "failed", message: typeof response.error === "string" ? response.error : "Pi rejected the session command." });
				}
			}
			const event = parseRpcLine(line);
			if (event) {
				const translated = translate(event);
				if (translated) emit(translated);
			}
		}
	});

	// Drains stderr so a chatty process can never block on a full pipe buffer,
	// while keeping only a bounded tail for diagnostics.
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_CHARS);
	});

	child.on("exit", (code) => {
		const reason = code === 0 || code === null ? "The Pi subprocess exited before replying." : `pi exited with code ${code}${stderr ? `: ${stderr}` : ""}`;
		for (const pending of pendingSessionCommands.values()) {
			clearTimeout(pending.timer);
			pending.resolve({ ok: false, reason: "failed", message: reason });
		}
		pendingSessionCommands.clear();
		for (const listener of exitListeners) listener(code === 0 || code === null ? undefined : reason);
	});

	function sendPrompt(type: "prompt" | "steer" | "follow_up", text: string): void {
		if (child.exitCode !== null) return;
		if (type === "prompt") {
			child.stdin.write(encodeRpcCommand({ type, message: text }));
			return;
		}
		child.stdin.write(`${JSON.stringify({ type, message: text })}\n`);
	}

	function sendSessionCommand(command: Record<string, unknown>): Promise<AgentSessionControlOutcome> {
		if (child.exitCode !== null) return Promise.resolve({ ok: false, reason: "failed", message: "The Pi subprocess has exited." });
		if (pendingSessionCommands.size >= MAX_PENDING_SESSION_COMMANDS) return Promise.resolve({ ok: false, reason: "failed", message: "Too many pending Pi session commands." });
		nextSessionCommandId += 1;
		const id = `zodiac-session-${nextSessionCommandId}`;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				pendingSessionCommands.delete(id);
				resolve({ ok: false, reason: "failed", message: `Pi did not answer ${String(command.type)} within ${SESSION_COMMAND_TIMEOUT_MS}ms.` });
			}, SESSION_COMMAND_TIMEOUT_MS);
			pendingSessionCommands.set(id, { resolve, timer });
			child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
		});
	}

	return {
		async prompt(text) {
			sendPrompt("prompt", text);
		},
		async steer(text) {
			sendPrompt("steer", text);
		},
		async followUp(text) {
			sendPrompt("follow_up", text);
		},
		async abort() {
			if (child.exitCode !== null) return;
			child.stdin.write(encodeRpcCommand({ type: "abort" }));
		},
		session: {
			setModel(provider, modelId) {
				return sendSessionCommand({ type: "set_model", provider, modelId });
			},
			compact(customInstructions) {
				return sendSessionCommand({ type: "compact", ...(customInstructions !== undefined ? { customInstructions } : {}) });
			},
			resume(sessionPath) {
				return sendSessionCommand({ type: "switch_session", sessionPath });
			},
			fork(entryId) {
				return sendSessionCommand({ type: "fork", entryId });
			},
		},
		onEvent(listener) {
			eventListeners.add(listener);
			return () => eventListeners.delete(listener);
		},
		onExit(listener) {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		dispose() {
			eventListeners.clear();
			for (const pending of pendingSessionCommands.values()) {
				clearTimeout(pending.timer);
				pending.resolve({ ok: false, reason: "failed", message: "The Pi subprocess integration was disposed." });
			}
			pendingSessionCommands.clear();
			if (child.exitCode === null) {
				child.stdin.end();
				child.kill();
			}
		},
	};
}

function assertNeverPiRpcEvent(event: never): ZodiacAgentEvent | undefined {
	throw new Error(`Unhandled PiRpcEvent: ${JSON.stringify(event)}`);
}
