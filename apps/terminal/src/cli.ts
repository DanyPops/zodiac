#!/usr/bin/env node
import { dirname } from "node:path";
import { createWorldStore } from "@zodiac/server/world";
import { connectRemoteWorldStore, type WorldClient } from "@zodiac/world";
import { appletId, MIN_FOOTER_HEIGHT, panelId, worldId, type Panel } from "@zodiac/protocol";
import { Key, matchesKey, ProcessTerminal } from "@earendil-works/pi-tui";
import { applyBootstrapToWorld } from "./bootstrap/apply-bootstrap.js";
import { classifyPath, type ClassifiedPath } from "./bootstrap/classify-path.js";
import { bootstrapWorkspace } from "./bootstrap/workspace-bootstrap.js";
import { createLectorHost, type LectorHost } from "./lector/lector-host.js";
import { parseTerminalArgs, type ZodiacTuiMode } from "./parse-args.js";
import { createZodiacExtensionUIContext } from "./pi/zodiac-extension-ui-context.js";
import { startFooterChat } from "./pi/start-footer-chat.js";
import { SemanticShellApplication } from "./shell/application.js";
import { buildMonolithGovernance } from "./monolith-governance.js";
import { spawnLocalDaemon, type LocalDaemon } from "./spawn-local-daemon.js";

/** The classified CLI argument names a real directory, a file (its containing directory is used), or nothing (falls back to the process's own cwd) -- matching how a real `pi` CLI session resolves its own working directory. */
function resolveAgentCwd(classified: ClassifiedPath): string {
  if (classified.kind === "directory") return classified.path;
  if (classified.kind === "file") return dirname(classified.path);
  return process.cwd();
}

const DEFAULT_CHAT_PANEL: Panel = {
  id: panelId("footer"),
  location: "bottom",
  alignment: "start",
  offset: 0,
  thickness: MIN_FOOTER_HEIGHT,
  thicknessUnit: "terminal-cells",
  lengthMode: "fill",
  visibilityMode: "normal",
  startCap: null,
  endCap: null,
  body: [appletId("chat")],
};

function fail(message: string): void {
  process.stderr.write(`Zodiac: ${message}\n`);
  process.exitCode = 1;
}

/**
 * Attaches to a real, already-running zodiacd -- a single resolved
 * connection reused for both World and the footer chat's own agent session,
 * rather than probing the daemon twice independently. Never falls back to
 * an embedded WorldStore on failure -- a rejection here is a real, explicit
 * startup error for `main()` to report and exit on (see the "apps/terminal:
 * explicit mode selection" Papyrus Task's own root-cause finding: silently
 * downgrading Remote to Monolith produced two structurally different trust
 * postures for the same chat feature, selected by network luck rather than
 * an explicit choice). Used by both "remote" mode (an externally-supplied
 * URL) and "local-server" mode (a URL this process just spawned itself) --
 * identical code path either way, only how the URL was obtained differs.
 */
async function attachToDaemon(daemonUrl: string): Promise<WorldClient & { dispose: () => void }> {
  try {
    return await connectRemoteWorldStore({ baseUrl: daemonUrl });
  } catch (error) {
    throw new Error(`could not reach zodiacd at ${daemonUrl} (${error instanceof Error ? error.message : String(error)})`);
  }
}

interface ResolvedBacking {
  readonly world: WorldClient;
  readonly remoteWorld: (WorldClient & { dispose: () => void }) | undefined;
  readonly daemonUrl: string | undefined;
  readonly localDaemon: LocalDaemon | undefined;
  /** Extra options folded into startFooterChat -- Monolith mode's own real governance object graph, or a daemonUrl for the two attached modes. */
  readonly chatOptions: { readonly daemonUrl?: string; readonly resourceLoader?: Awaited<ReturnType<typeof buildMonolithGovernance>>["resourceLoader"] };
}

/**
 * The one place mode selection actually happens -- resolves `mode` into a
 * real World backing and whatever startFooterChat needs to match it,
 * failing loudly (never silently degrading to a different mode) whenever
 * the chosen mode's own real backing can't be established.
 */
async function resolveBacking(mode: ZodiacTuiMode, daemonUrl: string | undefined, cwd: string): Promise<ResolvedBacking> {
  if (mode === "remote") {
    if (!daemonUrl) throw new Error("--mode remote requires --daemon <url> (or ZODIAC_DAEMON_URL)");
    const remoteWorld = await attachToDaemon(daemonUrl);
    return { world: remoteWorld, remoteWorld, daemonUrl, localDaemon: undefined, chatOptions: { daemonUrl } };
  }
  if (mode === "local-server") {
    const localDaemon = await spawnLocalDaemon();
    // A real, useful diagnostic for a human too, not just this mode's own
    // pty tests -- there is otherwise no way to discover which daemon this
    // process itself spawned (its stdout is captured internally by
    // spawnLocalDaemon, never forwarded to this terminal's own screen).
    process.stderr.write(`Zodiac: local-server mode -- spawned zodiacd at ${localDaemon.baseUrl}\n`);
    const remoteWorld = await attachToDaemon(localDaemon.baseUrl);
    return { world: remoteWorld, remoteWorld, daemonUrl: localDaemon.baseUrl, localDaemon, chatOptions: { daemonUrl: localDaemon.baseUrl } };
  }
  // Monolith: createWorldStore() in-process, plus the same real governance
  // object graph apps/service's own composition root builds (see
  // monolith-governance.ts's own doc comment) -- the actual fix for this
  // mode's own governance gap, not a bare, ungated WorldStore.
  // initialActiveToolNames is deliberately left unset here (not narrowed to
  // governance.toolNames): Pi's own default active-tool set already
  // includes both its built-ins (read/bash/edit/write) *and* anything a
  // resourceLoader contributes -- confirmed directly by
  // zodiac-agent-session.ts's own `tools` option only ever being set when
  // initialActiveToolNames is explicitly given (see visual-cue-vehicle-tool.test.ts's
  // own "item 4" test, which proves propose_visual_cue is active with no
  // initialActiveToolNames passed at all). Explicitly setting it here to
  // governance.toolNames alone would have *excluded* every Pi built-in --
  // a real regression, not a tightening.
  const governance = await buildMonolithGovernance(cwd);
  const world = createWorldStore(worldId("zodiac"), { panels: [DEFAULT_CHAT_PANEL] });
  return { world, remoteWorld: undefined, daemonUrl: undefined, localDaemon: undefined, chatOptions: { resourceLoader: governance.resourceLoader } };
}

async function main(): Promise<void> {
  const { path, mode, daemonUrl } = parseTerminalArgs(process.argv.slice(2));
  const classified = classifyPath(path);
  if (classified.kind === "missing") return fail(`no such path: ${classified.path}`);
  if (classified.kind === "denied") return fail(`permission denied: ${classified.path}`);
  if (classified.kind === "unsupported") return fail(`not a file or directory: ${classified.path}`);

  // Always resolved, unlike `host` -- a terminal pane needs *some* starting directory
  // regardless of whether a Lector workspace ever opened (resolveAgentCwd's own "none" branch
  // already falls back to process.cwd(), matching how a real `pi` CLI session or any ordinary
  // shell resolves its own working directory with no argument at all). openLectorExplorer's own
  // guard still additionally requires `lectorHost`, so browsing correctly stays gated on a real
  // workspace having opened -- only openTerminal only ever needed *this*, not that.
  const rootPath = resolveAgentCwd(classified);

  // The one explicit mode decision -- "remote" and "local-server" propagate
  // a real, actionable failure straight out of main() (never a silent
  // downgrade to "monolith"); see resolveBacking's own doc comment.
  let backing: ResolvedBacking;
  try {
    backing = await resolveBacking(mode, daemonUrl, rootPath);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const { world, remoteWorld, localDaemon, chatOptions } = backing;

  let host: LectorHost | undefined;
  if (classified.kind !== "none") {
    host = createLectorHost();
    await host.activate();
    const bootstrapped = await bootstrapWorkspace(classified, host);
    if (!bootstrapped.ok) {
      await host.dispose();
      await localDaemon?.stop();
      return fail(bootstrapped.message);
    }
    applyBootstrapToWorld(world, bootstrapped.value);
  }

  // The application must exist *before* startFooterChat() runs:
  // ZodiacExtensionUIContext needs a real host to route .custom() through,
  // but startFooterChat() is also what produces the FooterChatController the
  // application itself renders -- see attachFooterChat's own doc comment for
  // why this order (application, then uiContext, then startFooterChat, then
  // attach) is the one that actually breaks that cycle.
  const terminal = new ProcessTerminal();
  const application = new SemanticShellApplication(world, terminal, undefined, host, rootPath);
  const uiContext = createZodiacExtensionUIContext(application);
  const chat = await startFooterChat({ cwd: resolveAgentCwd(classified), uiContext, ...chatOptions });
  if (chat) application.attachFooterChat(chat.footerChat);
  let stopping = false;

  // Any live-conversation event (a streaming delta, a tool call, an error)
  // needs a re-render even though no key was pressed -- handleInput/resize
  // are the only other paths that ever call render(). A remote World's own
  // onChange fires from its background SSE tail (see connectRemoteWorldStore)
  // -- e.g. another client attached to the same daemon opening a Workspace --
  // and needs exactly the same re-render; subscribing unconditionally costs
  // nothing extra in embedded mode, since nothing else ever calls world.apply()
  // there except this same process's own synchronous keybinding/bootstrap path.
  const unsubscribeFooterChat = chat?.footerChat.subscribe(() => application.refresh());
  const unsubscribeWorld = world.onChange(() => application.refresh());

  async function stop(exitCode = 0): Promise<void> {
    if (stopping) return;
    stopping = true;
    terminal.showCursor();
    await terminal.drainInput(100, 20);
    terminal.stop();
    unsubscribeFooterChat?.();
    chat?.footerChat.dispose();
    chat?.dispose();
    unsubscribeWorld();
    remoteWorld?.dispose();
    await localDaemon?.stop();
    await host?.dispose();
    process.exitCode = exitCode;
  }

  terminal.start(
    (data) => {
      if (matchesKey(data, Key.ctrl("c"))) void stop();
      // "external" excluded for the same reason "footer" already is: Escape
      // is real, meaningful input to whatever owns focus there (a footer
      // draft, or a mounted extension Component's own modal-editing Escape,
      // e.g. pi-lector's modal editor's insert-to-normal-mode transition) --
      // never Zodiac's own "quit" shortcut while either holds focus.
      else if (matchesKey(data, Key.escape) && application.focusedRegion() !== "footer" && application.focusedRegion() !== "external") void stop();
      else application.handleInput(data);
    },
    () => application.resize(terminal.columns, terminal.rows),
  );
  terminal.setTitle("Zodiac");
  const boot = application.boot(terminal.columns, terminal.rows);
  if (!boot.ok) {
    terminal.write(`\r\nZodiac failed to start: ${boot.error.message}\r\n`);
    void stop(1);
  }
  process.once("SIGTERM", () => void stop());
  process.once("SIGHUP", () => void stop());
}

void main();
