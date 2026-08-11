import { decodeKittyPrintable, Key, matchesKey } from "@earendil-works/pi-tui";
import type { ShellFocus } from "./semantic-shell.js";

/**
 * Every semantic action a keystroke can produce -- the vocabulary the
 * "actual events API" (SemanticShell/FooterChatController's own methods)
 * is driven through. Nothing downstream of this type ever sees a raw
 * terminal byte again.
 */
export type ShellCommand =
  | { readonly type: "focus-next" }
  | { readonly type: "focus-previous" }
  | { readonly type: "enter-fullscreen" }
  | { readonly type: "exit-fullscreen" }
  | { readonly type: "open-lector-editor" }
  | { readonly type: "open-lector-explorer" }
  | { readonly type: "open-terminal" }
  | { readonly type: "expand-footer" }
  | { readonly type: "collapse-footer" }
  | { readonly type: "scroll-footer-up" }
  | { readonly type: "scroll-footer-down" }
  | { readonly type: "footer-submit" }
  | { readonly type: "footer-backspace" }
  | { readonly type: "footer-type"; readonly char: string };

/** The minimal state resolveShellCommand needs to disambiguate an otherwise-context-free keystroke (e.g. a printable character only ever means something while the footer is both focused and live). */
export interface KeymapContext {
  readonly focusedRegion: ShellFocus;
  readonly hasFooterChat: boolean;
}

/**
 * `decodeKittyPrintable` only covers Kitty CSI-u sequences (pi-tui's public
 * surface has no combined legacy+Kitty decoder -- `decodePrintableKey`
 * exists in pi-tui's own source but isn't part of its exported API). A
 * legacy terminal delivers an unmodified printable keystroke as the raw
 * character itself, so this covers that other real case: not empty, not an
 * escape sequence, and not a C0 control character (space and above, minus
 * DEL). Multi-byte UTF-8 (e.g. an emoji or accented letter) arrives as one
 * `data` chunk and is accepted whole.
 */
function plainPrintableChar(data: string): string | undefined {
  if (!data || data.startsWith("\u001b")) return undefined;
  const code = data.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return undefined;
  return data;
}

/**
 * The facade between real keymap wiring -- whatever escape sequence a
 * particular terminal happens to send for a particular chord -- and the
 * actual events API it drives. A pure function: given raw input bytes and
 * the minimal context needed to disambiguate them, it returns *what the
 * input means*, never *what to do about it*. That separation is what makes
 * every binding here independently testable without a GridTerminal, a
 * FooterChatController, or a render, and what keeps every terminal-protocol
 * detail (Kitty vs legacy CSI, exact escape sequences) out of
 * SemanticShellApplication's own dispatch logic entirely.
 *
 * Fullscreen is bound to Ctrl+Right (enter) / Ctrl+Left (exit) rather than
 * a mnemonic Ctrl+<letter> (the ecosystem's dominant convention is "z", per
 * tmux/zellij/several Neovim plugins) -- checked directly against pi-tui's
 * own matcher: `ctrl+shift+<letter>` has *no* legacy fallback at all, only
 * Kitty-protocol/xterm-modifyOtherKeys CSI-u sequences, so it is silently
 * dead (never fires, not even ambiguously) on any terminal implementing
 * neither -- confirmed via Ghostty's own devlog to include Terminal.app,
 * Windows Terminal, Alacritty, and Warp. `ctrl+<arrow>` has a hardcoded
 * legacy CSI form (`\x1b[1;5C`) that works everywhere, which is exactly why
 * footer resize (Ctrl+Up/Down) already used that family before this.
 *
 * SemanticShell itself -- not this facade -- decides whether entering
 * fullscreen is meaningful for whatever region happens to be focused; this
 * only decides that Ctrl+Right *means* "enter-fullscreen".
 */
export function resolveShellCommand(data: string, context: KeymapContext): ShellCommand | undefined {
  if (matchesKey(data, Key.tab)) return { type: "focus-next" };
  if (matchesKey(data, Key.shift("tab"))) return { type: "focus-previous" };
  if (matchesKey(data, Key.ctrl("right"))) return { type: "enter-fullscreen" };
  if (matchesKey(data, Key.ctrl("left"))) return { type: "exit-fullscreen" };
  // A plain Ctrl+<letter> is a real C0 control byte (Ctrl+E is 0x05) -- universally delivered by
  // every terminal, unlike Ctrl+Shift or bare-arrow-modifier chords (see this file's own doc
  // comment above on Ctrl+Right/Left's reliability check). Global, not footer-scoped, the same
  // way fullscreen's own Ctrl+Right/Left are -- opening the editor is meaningful regardless of
  // which region currently has focus.
  if (matchesKey(data, Key.ctrl("e"))) return { type: "open-lector-editor" };
  // Same C0-control-byte reliability bar as Ctrl+E right above (Ctrl+O is 0x0F, universally
  // delivered) -- a distinct global chord for the explorer rather than overloading Ctrl+E's own
  // meaning, matching how oil.nvim itself keeps "open a file" and "browse a directory" as two
  // separate real entry points rather than one that infers which the user wants.
  if (matchesKey(data, Key.ctrl("o"))) return { type: "open-lector-explorer" };
  // Same C0-control-byte reliability bar as Ctrl+E/Ctrl+O above (Ctrl+T is 0x14, universally
  // delivered) -- opening a real shell pane is meaningful regardless of which region currently
  // has focus, the same way the other two native-host entry points already are. The pane's own
  // exit chord (Ctrl+]) lives entirely inside TerminalPaneComponent.handleInput, not here -- once
  // the pane is open it owns every keystroke via SemanticShellApplication's externalComponent
  // pass-through, exactly like the editor/explorer already do, so this file never sees Ctrl+]
  // at all while a terminal is mounted.
  if (matchesKey(data, Key.ctrl("t"))) return { type: "open-terminal" };
  if (!context.hasFooterChat || context.focusedRegion !== "footer") return undefined;
  // Neovim/tmux-style incremental resize: repeatable, not a modal
  // resize-prefix step, and scoped to the footer being the focused region
  // (matching every other footer-only keybinding here) rather than a
  // global hotkey -- there is nothing else in this shell yet that a resize
  // keybinding could apply to.
  if (matchesKey(data, Key.ctrl("up"))) return { type: "expand-footer" };
  if (matchesKey(data, Key.ctrl("down"))) return { type: "collapse-footer" };
  // A distinct family from Ctrl+Up/Down's own *resize* -- Page Up/Down
  // *scrolls within* whatever height the footer already has, matching tmux
  // copy-mode and opentui ScrollBox's own line-scroll convention exactly.
  // Key.pageUp/pageDown have real hardcoded legacy CSI fallbacks in pi-tui's
  // own matcher (\x1b[5~/\x1b[6~), the same reliability bar every other
  // binding in this file was checked against.
  if (matchesKey(data, Key.pageUp)) return { type: "scroll-footer-up" };
  if (matchesKey(data, Key.pageDown)) return { type: "scroll-footer-down" };
  if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return { type: "footer-submit" };
  if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) return { type: "footer-backspace" };
  const char = decodeKittyPrintable(data) ?? plainPrintableChar(data);
  if (char) return { type: "footer-type", char };
  return undefined;
}
