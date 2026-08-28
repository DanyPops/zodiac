import { createRequire } from "node:module";
import * as pty from "node-pty";

// Same technique as xterm-headless-shim.ts: @xterm/headless ships CJS, and
// this module needs to work identically whether it's loaded through Vite's
// module graph (a real *.pty.test.ts, where the vitest.config.ts alias
// already redirects `@xterm/headless` here anyway) or run as a plain Node
// script outside Vitest entirely (a real ad hoc smoke check) -- a bare
// `import` would only work in the former. `createRequire` sidesteps both
// module systems' quirks the same way in either context.
const require = createRequire(import.meta.url);
const headless = require("@xterm/headless") as { Terminal: new (options: Record<string, unknown>) => XtermHeadlessTerminal };

interface XtermHeadlessTerminal {
  write(data: string, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
  readonly buffer: { readonly active: { getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined } };
  readonly rows: number;
}

/**
 * How long the PTY must go quiet before a screen is considered "settled" --
 * see spawnLiveTerminal's own doc comment on `lastDataAt` for the real race
 * this closes: a full-screen repaint can legitimately arrive from a real
 * PTY as several separate chunks (a pty's kernel-side buffer is small, well
 * under a redraw's byte size), so a marker appearing early in the stream
 * (e.g. text near the top of the screen) is not proof the rest of the frame
 * has arrived. 30ms is comfortably above realistic inter-chunk gaps for a
 * single logical write (sub-millisecond to a few ms) without meaningfully
 * slowing down a test suite.
 */
const SETTLE_IDLE_MS = 30;

function poll(predicate: () => boolean, timeoutMs: number, describe: () => string): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolveWait, reject) => {
    const tick = () => {
      if (predicate()) return resolveWait();
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`Timed out waiting for ${describe()}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

export interface LiveTerminalOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Splits at most this many reconstructed-output chunks immediately after ESC, exercising parser boundaries independently of the host PTY's incidental chunking. */
  readonly adversarialEscapeSplits?: number;
}

/**
 * A real child process behind a real PTY (node-pty), with its live output
 * continuously fed into a real `@xterm/headless` Terminal for proper
 * cursor-addressed 2D-grid reconstruction -- the same engine
 * `@danypops/pi-tui-harness`'s `renderToTerminal` uses for static captured
 * output, but wired to an interactive, still-running process instead of a
 * fixed byte array. This is the piece that was missing: the two existing
 * `*.pty.test.ts` files spawn a real PTY but only inspect its raw output
 * via `stripTerminalSequences` (a flat, ANSI-stripped string, not a real
 * screen), which cannot correctly represent cursor-addressed rendering like
 * GridTerminal's own output. Anything that needs to assert "what does the
 * screen actually look like right now" against a live, running Zodiac
 * TUI process -- a real regression test, or ad hoc exploratory verification
 * -- should use this rather than hand-rolling PTY+xterm wiring again.
 */
export interface LiveTerminal {
  /** Sends raw bytes to the child's stdin, exactly as a real keystroke would arrive. */
  write(data: string): void;
  /**
   * Resizes both the real PTY and the reconstructed terminal together, so `snapshot()` never
   * drifts from what the child process itself believes its viewport is. Async: waits for every
   * write already queued (at the OLD dimensions) to finish being processed by the reconstruction
   * terminal before actually changing its dimensions -- resizing a real `@xterm/headless` Terminal
   * while writes targeting its old dimensions are still in flight is a real hazard class (cursor
   * positions computed against stale bounds), not merely a style preference. Found as a real,
   * reproducible stall (not a hypothetical) migrating cli.pty.test.ts onto this harness: resizing
   * immediately after a large redraw's worth of still-queued writes silently wedged the write
   * chain forever, with every later write's own completion callback never firing.
   */
  resize(cols: number, rows: number): Promise<void>;
  /** The full reconstructed screen, one row per line, trailing whitespace trimmed per row -- what a person looking at a real terminal running this process would see right now. */
  snapshot(): string;
  /**
   * Waits for `expected` to appear, *and* for the PTY to then go quiet for
   * SETTLE_IDLE_MS -- not just the first moment the substring is visible.
   * A real repaint of the whole screen can arrive in more than one chunk;
   * resolving on the first sighting alone can return while the rest of the
   * frame is still in flight, leaving a caller's very next `snapshot()` torn
   * between old and new content. This was found as a real, intermittently
   * reproduced failure, not a hypothetical.
   */
  waitForText(expected: string, timeoutMs?: number): Promise<void>;
  /** Resolves once the child process has exited, with its exit code. */
  waitForExit(timeoutMs?: number): Promise<number | null>;
  /**
   * The raw, unprocessed byte stream received from the child so far -- an escape hatch for the
   * rare genuinely protocol-level assertion (e.g. "was the cursor-show sequence `\x1b[?25h`
   * actually emitted", or terminal-mode restoration) that a reconstructed screen has no way to
   * represent, since it's a statement about the wire protocol, not about what's displayed.
   * Prefer snapshot()/waitForText() for anything about what a person looking at the screen would
   * actually see.
   */
  rawOutput(): string;
  /** Kills the child (if still running) and disposes the reconstructed terminal -- always safe to call more than once. */
  dispose(): Promise<void>;
}

/** Spawns `command args` behind a real PTY and wires its output into a real, live-reconstructed terminal. */
export function spawnLiveTerminal(command: string, args: readonly string[], options: LiveTerminalOptions): LiveTerminal {
  if (!Number.isSafeInteger(options.adversarialEscapeSplits ?? 0) || (options.adversarialEscapeSplits ?? 0) < 0 || (options.adversarialEscapeSplits ?? 0) > 1_000) {
    throw new Error("adversarialEscapeSplits must be an integer from 0 through 1000");
  }
  const terminal = new headless.Terminal({ cols: options.cols, rows: options.rows, allowProposedApi: true });
  const child = pty.spawn(command, [...args], {
    name: "xterm-256color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: { ...process.env, ...options.env, TERM: "xterm-256color" },
  });

  // `Terminal.write()` is asynchronous (its own signature accepts a
  // completion callback) -- firing it per chunk without tracking completion
  // let `snapshot()` read the buffer mid-application, a real, intermittently
  // reproduced bug (a torn screen mixing not-yet- and already-applied rows).
  // Chaining writes means anything that awaits `writeChain` sees a state
  // that is at least as new as every chunk received so far.
  let writeChain: Promise<void> = Promise.resolve();
  let remainingEscapeSplits = options.adversarialEscapeSplits ?? 0;
  /** Bumped on every chunk -- see SETTLE_IDLE_MS's own doc comment for the second, independent race this closes (more chunks still arriving after a predicate first holds). */
  let lastDataAt = Date.now();
  let rawOutput = "";
  child.onData((data) => {
    lastDataAt = Date.now();
    rawOutput += data;
    const chunks: string[] = [];
    let offset = 0;
    while (remainingEscapeSplits > 0) {
      const escape = data.indexOf("\x1b", offset);
      if (escape === -1) break;
      chunks.push(data.slice(offset, escape + 1));
      offset = escape + 1;
      remainingEscapeSplits--;
    }
    if (offset < data.length) chunks.push(data.slice(offset));
    for (const chunk of chunks) {
      writeChain = writeChain.then(() => new Promise<void>((resolveWrite) => terminal.write(chunk, resolveWrite)));
    }
  });

  let exitCode: number | null | undefined;
  const exited = new Promise<number | null>((resolveExit) => {
    child.onExit(({ exitCode: code }) => {
      exitCode = code;
      resolveExit(code);
    });
  });

  function snapshot(): string {
    const lines: string[] = [];
    for (let row = 0; row < terminal.rows; row++) lines.push(terminal.buffer.active.getLine(row)?.translateToString(true) ?? "");
    return lines.join("\n");
  }

  // 12s, not 5s: dist/cli.js no longer bundles @earendil-works/* (a real,
  // deliberate build-config fix -- a bundled copy is invisible to a
  // dynamically-loaded extension's own separate copy of the same package,
  // silently breaking custom model providers). Resolving that larger,
  // unbundled dependency tree from disk is measurably slower to cold-start,
  // especially with several of this file's own PTY tests spawning real
  // processes concurrently in CI/local test runs.
  function waitForText(expected: string, timeoutMs = 12_000): Promise<void> {
    const startedAt = Date.now();
    return new Promise((resolveWait, reject) => {
      const tick = () => {
        void writeChain.then(() => {
          if (snapshot().includes(expected) && Date.now() - lastDataAt >= SETTLE_IDLE_MS) return resolveWait();
          if (Date.now() - startedAt > timeoutMs) {
            return reject(new Error(`Timed out waiting for PTY screen to contain ${JSON.stringify(expected)} and settle; last snapshot:\n${snapshot()}`));
          }
          setTimeout(tick, 10);
        });
      };
      tick();
    });
  }

  return {
    write: (data) => child.write(data),
    resize: async (cols, rows) => {
      await writeChain;
      terminal.resize(cols, rows);
      child.resize(cols, rows);
    },
    snapshot,
    waitForText,
    waitForExit: (timeoutMs = 5_000) => (exitCode !== undefined ? Promise.resolve(exitCode) : Promise.race([exited, poll(() => exitCode !== undefined, timeoutMs, () => "child process to exit").then(() => exitCode ?? null)])),
    rawOutput: () => rawOutput,
    dispose: async () => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
      terminal.dispose();
    },
  };
}
