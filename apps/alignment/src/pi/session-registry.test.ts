import { describe, expect, it, vi } from "vitest";
import { createPiSessionRegistry } from "./session-registry.js";
import type { PiRpcSession } from "./process-rpc-session.js";

function fakeSession(): PiRpcSession {
	const exitListeners = new Set<(code: number | null) => void>();
	return {
		sendPrompt: vi.fn(),
		abort: vi.fn(),
		stderr: "",
		onEvent: vi.fn(() => () => {}),
		onExit: vi.fn((listener) => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		}),
		dispose: vi.fn(),
	};
}

describe("createPiSessionRegistry", () => {
	it("creates a session via the injected spawn function and returns a distinct id each time", () => {
		const spawn = vi.fn(fakeSession);
		const registry = createPiSessionRegistry(spawn);
		const first = registry.create();
		const second = registry.create();
		expect(first).not.toBe(second);
		expect(spawn).toHaveBeenCalledTimes(2);
	});

	it("get() returns the session created for an id, and undefined for an unknown one", () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const id = registry.create();
		expect(registry.get(id)).toBe(session);
		expect(registry.get("unknown")).toBeUndefined();
	});

	it("remove() disposes the session and forgets it", () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const id = registry.create();
		registry.remove(id);
		expect(session.dispose).toHaveBeenCalledOnce();
		expect(registry.get(id)).toBeUndefined();
	});

	it("forgets a session on its own exit, without an explicit remove() call", () => {
		const session = fakeSession();
		const registry = createPiSessionRegistry(() => session);
		const id = registry.create();
		const onExitListener = (session.onExit as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as (code: number | null) => void;
		onExitListener(0);
		expect(registry.get(id)).toBeUndefined();
	});

	it("disposeAll() disposes every live session and clears the registry", () => {
		const sessions = [fakeSession(), fakeSession()];
		let index = 0;
		const registry = createPiSessionRegistry(() => sessions[index++]!);
		const first = registry.create();
		const second = registry.create();
		registry.disposeAll();
		expect(sessions[0]!.dispose).toHaveBeenCalledOnce();
		expect(sessions[1]!.dispose).toHaveBeenCalledOnce();
		expect(registry.get(first)).toBeUndefined();
		expect(registry.get(second)).toBeUndefined();
	});
});
