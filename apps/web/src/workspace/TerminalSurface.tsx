import { useEffect, useRef, useState } from "react";
import { resolveZodiacdBaseUrl } from "../platform/zodiacd-config.js";
import { createHttpTerminalClient, type TerminalClient, type TerminalConnection } from "../terminal/terminal-client.js";
import { createXtermUi, type TerminalUiPort } from "../terminal/terminal-ui-port.js";

/** Constructed once, same convention App.tsx's own module-level piClient/conversationClient already establish -- surface-templates.tsx's render() is a zero-arg factory, so there's no per-render prop-injection path from App.tsx for this one. */
const defaultTerminalClient = createHttpTerminalClient({ baseUrl: resolveZodiacdBaseUrl() });

export interface TerminalSurfaceContentProps {
	/** Overridable for tests; production always uses the module-level zodiacd-backed singleton above. */
	readonly client?: TerminalClient;
	/** Overridable for tests -- production always mounts real xterm.js (createXtermUi). */
	readonly createUi?: () => TerminalUiPort;
	/** Attach to an already-live session (e.g. a second Terminal Surface docked onto the same shell another panel already opened) instead of spawning a new one. */
	readonly sessionId?: string;
}

type TerminalStatus = "connecting" | "live" | "exited" | "error";

/**
 * The Terminal Surface Template's docked content -- split out from
 * surface-templates.tsx for the same Fast-Refresh reason ActivitySurface.tsx
 * already documents. A real, interactive shell hosted by zodiacd
 * (--enable-terminal), not this browser: node-pty can't run here, so every
 * byte in and out crosses the one WebSocket TerminalClient owns.
 */
export function TerminalSurfaceContent({ client = defaultTerminalClient, createUi = createXtermUi, sessionId }: TerminalSurfaceContentProps): React.JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<TerminalStatus>("connecting");
	const [exitCode, setExitCode] = useState<number | undefined>(undefined);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let disposed = false;
		let connection: TerminalConnection | undefined;
		const ui = createUi();

		const initialSize = ui.mount(container, (cols, rows) => connection?.resize(cols, rows));
		const unsubscribeInput = ui.onData((data) => connection?.sendInput(data));

		// `disposed` is genuinely reassigned by the cleanup closure below at a
		// time the type checker can't model (React calling it after some real,
		// unpredictable delay past the `await` above) -- both checks below are a
		// real async race guard, not a redundant one, despite looking constant
		// from a purely-synchronous control-flow reading.
		void (async () => {
			try {
				const id = sessionId ?? (await client.createSession());
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above.
				if (disposed) return;
				connection = client.connect(id, {
					onOutput: (data) => ui.write(data),
					onExit: (code) => {
						setExitCode(code);
						setStatus("exited");
					},
					onError: () => setStatus("error"),
				});
				// Safe to call immediately even though the WebSocket is still
				// CONNECTING at this exact instant -- TerminalClient's own connect()
				// queues outgoing frames until the handshake completes.
				connection.resize(initialSize.cols, initialSize.rows);
				setStatus("live");
			} catch {
				// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see comment above.
				if (!disposed) setStatus("error");
			}
		})();

		return () => {
			disposed = true;
			unsubscribeInput();
			connection?.close();
			ui.dispose();
		};
	}, [client, createUi, sessionId]);

	return (
		<div className="relative h-full w-full bg-black">
			<div ref={containerRef} className="h-full w-full" />
			{status === "exited" && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/80 px-3 py-1 text-xs text-gray-300">Shell exited{exitCode !== undefined ? ` (code ${exitCode})` : ""}</div>
			)}
			{status === "error" && <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-red-900/80 px-3 py-1 text-xs text-white">Terminal connection error</div>}
		</div>
	);
}
