import { type ChildProcessByStdio, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import { encodeRpcCommand, parseRpcLine, type PiRpcCommand, type PiRpcEvent } from "./rpc-protocol.js";

const DEFAULT_COMMAND = ["pi", "--mode", "rpc", "--no-session"] as const;

/** Bounds how much stderr this adapter retains for diagnostics -- a real crash's error text is useful, an unbounded buffer of a runaway process's output is not. */
const MAX_STDERR_CHARS = 8_000;

export interface PiRpcSessionOptions {
	/** Defaults to `pi --mode rpc --no-session`. Overridden by tests (a fixture stand-in process) and by callers needing a working directory or extra CLI flags. */
	readonly command?: readonly string[];
	readonly cwd?: string;
}

export interface PiRpcSession {
	sendPrompt: (message: string) => void;
	abort: () => void;
	/** The process's own stderr, truncated to MAX_STDERR_CHARS -- for surfacing a spawn/crash reason, not a full log. */
	readonly stderr: string;
	onEvent: (listener: (event: PiRpcEvent) => void) => () => void;
	onExit: (listener: (code: number | null) => void) => () => void;
	dispose: () => void;
}

/**
 * Spawns a real `pi --mode rpc` child process and speaks its documented
 * JSONL protocol (docs/rpc.md in pi-mono). Framing is done by hand rather
 * than with Node's `readline`: the protocol is explicit that only `\n` is a
 * record delimiter, while `readline` also splits on U+2028/U+2029, both of
 * which are valid inside a JSON string and would corrupt a message
 * mid-stream.
 */
export function spawnPiRpcSession(options: PiRpcSessionOptions = {}): PiRpcSession {
	const [command = DEFAULT_COMMAND[0], ...args] = options.command ?? DEFAULT_COMMAND;
	const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(command, args, {
		cwd: options.cwd,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const eventListeners = new Set<(event: PiRpcEvent) => void>();
	const exitListeners = new Set<(code: number | null) => void>();
	let stderr = "";

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
			if (event) for (const listener of eventListeners) listener(event);
		}
	});

	// Drains stderr so a chatty process can never block on a full pipe buffer,
	// while keeping only a bounded tail for diagnostics.
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = (stderr + chunk.toString("utf8")).slice(-MAX_STDERR_CHARS);
	});

	child.on("exit", (code) => {
		for (const listener of exitListeners) listener(code);
	});

	function send(rpcCommand: PiRpcCommand): void {
		if (child.exitCode !== null) return;
		child.stdin.write(encodeRpcCommand(rpcCommand));
	}

	return {
		sendPrompt(message) {
			send({ type: "prompt", message });
		},
		abort() {
			send({ type: "abort" });
		},
		get stderr() {
			return stderr;
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
			// Only stdout event listeners are cleared -- exit listeners must survive
			// dispose() itself, since killing the process is exactly what makes the
			// eventual exit event they're waiting for happen.
			eventListeners.clear();
			if (child.exitCode === null) {
				child.stdin.end();
				child.kill();
			}
		},
	};
}
