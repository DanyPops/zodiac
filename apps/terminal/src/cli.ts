#!/usr/bin/env node
import { dirname } from "node:path";
import { connectRemoteWorldStore, createWorldStore, type WorldClientPort } from "@zodiac/server/world";
import { worldId } from "@zodiac/protocol";
import { Key, matchesKey, ProcessTerminal } from "@earendil-works/pi-tui";
import { applyBootstrapToWorld } from "./bootstrap/apply-bootstrap.js";
import { classifyPath, type ClassifiedPath } from "./bootstrap/classify-path.js";
import { bootstrapWorkspace } from "./bootstrap/workspace-bootstrap.js";
import { createLectorHost, type LectorHost } from "./lector/lector-host.js";
import { parseTerminalArgs } from "./parse-args.js";
import { createZodiacExtensionUIContext } from "./pi/zodiac-extension-ui-context.js";
import { startFooterChat } from "./pi/start-footer-chat.js";
import { SemanticShellApplication } from "./shell/application.js";

/** The classified CLI argument names a real directory, a file (its containing directory is used), or nothing (falls back to the process's own cwd) -- matching how a real `pi` CLI session resolves its own working directory. */
function resolveAgentCwd(classified: ClassifiedPath): string {
  if (classified.kind === "directory") return classified.path;
  if (classified.kind === "file") return dirname(classified.path);
  return process.cwd();
}

function fail(message: string): void {
  process.stderr.write(`Zodiac: ${message}\n`);
  process.exitCode = 1;
}

/**
 * Attempts to attach to a real, already-running zodiacd instead of this
 * process's own embedded WorldStore (zodiacd stage 5) -- a single resolved
 * decision reused for both World and the footer chat's own agent session,
 * rather than probing the daemon twice independently: if World can't be
 * reached, there is no reason to expect the agent-session routes on the
 * same daemon would fare any better. Falls back to `undefined` (today's
 * fully-embedded mode, unchanged) on any failure -- a wrong URL, no daemon
 * listening, or one that's simply slow to answer -- so a misconfigured
 * `--daemon`/`ZODIAC_DAEMON_URL` degrades to "just works locally" instead of
 * refusing to start at all.
 */
async function attachToDaemon(daemonUrl: string): Promise<(WorldClientPort & { dispose: () => void }) | undefined> {
  try {
    return await connectRemoteWorldStore({ baseUrl: daemonUrl });
  } catch (error) {
    process.stderr.write(`Zodiac: could not reach zodiacd at ${daemonUrl} (${error instanceof Error ? error.message : String(error)}) -- falling back to embedded mode\n`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const { path, daemonUrl } = parseTerminalArgs(process.argv.slice(2));
  const classified = classifyPath(path);
  if (classified.kind === "missing") return fail(`no such path: ${classified.path}`);
  if (classified.kind === "denied") return fail(`permission denied: ${classified.path}`);
  if (classified.kind === "unsupported") return fail(`not a file or directory: ${classified.path}`);

  const remoteWorld = daemonUrl ? await attachToDaemon(daemonUrl) : undefined;
  const attached = remoteWorld !== undefined;
  const world: WorldClientPort = remoteWorld ?? createWorldStore(worldId("zodiac"));
  let host: LectorHost | undefined;
  // Always resolved, unlike `host` -- a terminal pane needs *some* starting directory
  // regardless of whether a Lector workspace ever opened (resolveAgentCwd's own "none" branch
  // already falls back to process.cwd(), matching how a real `pi` CLI session or any ordinary
  // shell resolves its own working directory with no argument at all). openLectorExplorer's own
  // guard still additionally requires `lectorHost`, so browsing correctly stays gated on a real
  // workspace having opened -- only openTerminal only ever needed *this*, not that.
  const rootPath = resolveAgentCwd(classified);
  if (classified.kind !== "none") {
    host = createLectorHost();
    await host.activate();
    const bootstrapped = await bootstrapWorkspace(classified, host);
    if (!bootstrapped.ok) {
      await host.dispose();
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
  const chat = await startFooterChat({ cwd: resolveAgentCwd(classified), uiContext, daemonUrl: attached ? daemonUrl : undefined });
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
