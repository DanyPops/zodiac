import { resolveAlignmentAgentDir, seedAlignmentAuthOnce } from "@alignment/server/pi-agent-dir";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { encodeRpcCommand, extractMessageText, parseRpcLine, type PiRpcEvent } from "@danypops/pi-rpc-protocol";
import type { AgentIntegrationPort, AlignmentAgentEvent } from "./agent-integration-port.js";

const DEFAULT_COMMAND = ["pi", "--mode", "rpc", "--no-session"] as const;

/** Bounds how much stderr this adapter retains for diagnostics -- a real crash's error text is useful, an unbounded buffer of a runaway process's output is not. */
const MAX_STDERR_CHARS = 8_000;

export interface SubprocessAgentIntegrationOptions {
	/** Defaults to `pi --mode rpc --no-session`. Overridden by tests (a fixture stand-in process) and by callers needing extra CLI flags. */
	readonly command?: readonly string[];
	readonly cwd?: string;
	/**
	 * Alignment's own namespaced Pi config/extension/session/auth directory --
	 * propagated to the spawned `pi` process via PI_CODING_AGENT_DIR, kept in
	 * parity with apps/web/src/pi/process-rpc-session.ts (this adapter's
	 * own doc comment notes it was ported from that file). Defaults to
	 * resolveAlignmentAgentDir(); injectable for hermetic tests.
	 */
	readonly agentDir?: string;
	/** Where a one-time auth.json seed is copied from. Defaults to the user's real ~/.pi/agent. */
	readonly sourceAgentDir?: string;
}

/**
 * The documented external-process fallback (story 8's own words): spawns a
 * real `pi --mode rpc` child process and speaks its JSONL wire protocol,
 * translating PiRpcEvent down to the exact same AlignmentAgentEvent type
 * InProcessAgentIntegration produces -- a caller behind AgentIntegrationPort
 * cannot tell which adapter it's holding.
 *
 * Ported from apps/web/src/pi/process-rpc-session.ts, which already
 * proved this spawn/framing approach works end to end (see that file's own
 * tests and the live multi-instance smoke test run against it). This
 * version additionally translates events to Alignment's bounded vocabulary
 * instead of leaving that to each caller.
 *
 * Known parity gap: pi's RPC wire protocol only has a "prompt" command --
 * there is no distinct steer/followUp command on the wire. steer() and
 * followUp() both degrade to sending a plain prompt here, unlike
 * InProcessAgentIntegration's real steer()/followUp() calls against
 * AgentSession. A caller that needs faithful steer/followUp semantics over
 * a subprocess would need pi's RPC protocol extended first.
 */
export function createSubprocessAgentIntegration(options: SubprocessAgentIntegrationOptions = {}): AgentIntegrationPort {
	const [command = DEFAULT_COMMAND[0], ...args] = options.command ?? DEFAULT_COMMAND;
	const agentDir = options.agentDir ?? resolveAlignmentAgentDir();
	seedAlignmentAuthOnce({ agentDir, sourceAgentDir: options.sourceAgentDir ?? join(homedir(), ".pi", "agent") });
	const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(command, args, {
		cwd: options.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});

	const eventListeners = new Set<(event: AlignmentAgentEvent) => void>();
	const exitListeners = new Set<(reason: string | undefined) => void>();
	let stderr = "";

	function emit(event: AlignmentAgentEvent): void {
		for (const listener of eventListeners) listener(event);
	}

	/** Exhaustive over PiRpcEvent's own variants; most map to nothing -- see agent-integration-port.ts's own doc comment for why the bounded event type is deliberately smaller. */
	function translate(event: PiRpcEvent): AlignmentAgentEvent | undefined {
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
			case "unknown-event":
				return undefined;
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
		for (const listener of exitListeners) listener(code === 0 || code === null ? undefined : `pi exited with code ${code}${stderr ? `: ${stderr}` : ""}`);
	});

	function send(text: string): void {
		if (child.exitCode !== null) return;
		child.stdin.write(encodeRpcCommand({ type: "prompt", message: text }));
	}

	return {
		async prompt(text) {
			send(text);
		},
		async steer(text) {
			send(text);
		},
		async followUp(text) {
			send(text);
		},
		async abort() {
			if (child.exitCode !== null) return;
			child.stdin.write(encodeRpcCommand({ type: "abort" }));
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
			if (child.exitCode === null) {
				child.stdin.end();
				child.kill();
			}
		},
	};
}

function assertNeverPiRpcEvent(event: never): AlignmentAgentEvent | undefined {
	throw new Error(`Unhandled PiRpcEvent: ${JSON.stringify(event)}`);
}
