import { describe, expect, it, vi } from "vitest";
import type { TerminalPtyPort } from "./terminal-pty-port.js";
import { createTerminalSessionRegistry } from "./terminal-session-registry.js";

function fakePty(): TerminalPtyPort & { emitData(data: string): void; emitExit(exitCode: number): void } {
	const dataListeners = new Set<(data: string) => void>();
	const exitListeners = new Set<(exitCode: number) => void>();
	return {
		write: vi.fn(),
		resize: vi.fn(),
		kill: vi.fn(),
		onData: (listener) => {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		onExit: (listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		emitData(data) {
			for (const listener of dataListeners) listener(data);
		},
		emitExit(exitCode) {
			for (const listener of exitListeners) listener(exitCode);
		},
	};
}

describe("createTerminalSessionRegistry", () => {
	it("create() returns a fresh sessionId each time, backed by a freshly spawned pty", () => {
		const spawn = vi.fn(() => fakePty());
		const registry = createTerminalSessionRegistry(spawn);

		const a = registry.create();
		const b = registry.create();
		expect(a).not.toBe(b);
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("forwards a client-requested cwd to the spawn factory, undefined when none was given", () => {
		const spawn = vi.fn(() => fakePty());
		const registry = createTerminalSessionRegistry(spawn);

		registry.create("/repos/pipes");
		expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repos/pipes" }));
		registry.create();
		expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: undefined }));
	});

	it("get() resolves a live session's pty by id; an unknown id is undefined", () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		const id = registry.create();
		expect(registry.get(id)).toBeDefined();
		expect(registry.get("nope")).toBeUndefined();
	});

	it("list() reports every live session's id and createdAt", () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		const id = registry.create();
		const sessions = registry.list();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.sessionId).toBe(id);
		expect(typeof sessions[0]?.createdAt).toBe("number");
	});

	it("history() accumulates every byte of output a session's pty ever emits, in order, for a newly-attaching client to replay", () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const id = registry.create();

		pty.emitData("$ ");
		pty.emitData("echo hi\r\nhi\r\n");

		expect(registry.history(id)).toBe("$ echo hi\r\nhi\r\n");
	});

	it("history() for an unknown session is an empty string, not an error", () => {
		const registry = createTerminalSessionRegistry(() => fakePty());
		expect(registry.history("nope")).toBe("");
	});

	it("history() is bounded -- a very long-running session's buffered output never grows without limit", () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty, { maxHistoryChars: 10 });
		const id = registry.create();

		pty.emitData("0123456789");
		pty.emitData("ABCDE");

		expect(registry.history(id)).toBe("56789ABCDE");
		expect(registry.history(id).length).toBe(10);
	});

	it("remove() kills the pty and drops it from the registry", () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const id = registry.create();

		registry.remove(id);
		expect(pty.kill).toHaveBeenCalledOnce();
		expect(registry.get(id)).toBeUndefined();
	});

	it("a shell that exits on its own (onExit fires) is dropped from the registry, without this daemon ever calling kill() itself", () => {
		const pty = fakePty();
		const registry = createTerminalSessionRegistry(() => pty);
		const id = registry.create();

		pty.emitExit(0);
		expect(registry.get(id)).toBeUndefined();
		expect(pty.kill).not.toHaveBeenCalled();
	});

	it("disposeAll() kills every live session and clears the registry -- daemon shutdown must never orphan a shell", () => {
		const ptyA = fakePty();
		const ptyB = fakePty();
		const spawn = vi.fn().mockReturnValueOnce(ptyA).mockReturnValueOnce(ptyB);
		const registry = createTerminalSessionRegistry(spawn);
		registry.create();
		registry.create();

		registry.disposeAll();
		expect(ptyA.kill).toHaveBeenCalledOnce();
		expect(ptyB.kill).toHaveBeenCalledOnce();
		expect(registry.list()).toHaveLength(0);
	});
});
