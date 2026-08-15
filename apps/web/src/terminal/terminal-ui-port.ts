import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

/**
 * The seam between TerminalSurface.tsx's data-flow logic and real xterm.js
 * -- the same reason TerminalPtyPort exists server-side (apps/service's own
 * terminal-pty-port.ts): a fake implementation lets TerminalSurface.test.tsx
 * assert exactly what the component sends/receives without a real DOM
 * terminal, jsdom polyfills, or timing quirks in the way. createXtermUi is
 * the one real adapter, used in production.
 */
export interface TerminalUiPort {
	/** Opens xterm.js into `container`, fits it to the container's current size, and wires a ResizeObserver to keep fitting it -- returns the initial {cols, rows}, calls onResize on every subsequent fit. */
	mount: (container: HTMLElement, onResize: (cols: number, rows: number) => void) => { cols: number; rows: number };
	write: (data: string) => void;
	/** Fires on every keystroke/paste the user makes directly in the terminal; returns an unsubscribe function. */
	onData: (listener: (data: string) => void) => () => void;
	dispose: () => void;
}

export function createXtermUi(): TerminalUiPort {
	const terminal = new Terminal({ cursorBlink: true, convertEol: true });
	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	let resizeObserver: ResizeObserver | undefined;

	return {
		mount(container, onResize) {
			terminal.open(container);
			fitAddon.fit();
			resizeObserver = new ResizeObserver(() => {
				fitAddon.fit();
				onResize(terminal.cols, terminal.rows);
			});
			resizeObserver.observe(container);
			return { cols: terminal.cols, rows: terminal.rows };
		},
		write: (data) => terminal.write(data),
		onData: (listener) => {
			const disposable = terminal.onData(listener);
			return () => disposable.dispose();
		},
		dispose: () => {
			resizeObserver?.disconnect();
			terminal.dispose();
		},
	};
}
