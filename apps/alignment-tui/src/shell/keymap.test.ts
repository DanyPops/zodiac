import { describe, expect, it } from "vitest";
import { resolveShellCommand } from "./keymap.js";

const withFooter = { focusedRegion: "footer" as const, hasFooterChat: true };
const withoutFooterChat = { focusedRegion: "footer" as const, hasFooterChat: false };
const bodyFocused = { focusedRegion: "body" as const, hasFooterChat: true };

describe("resolveShellCommand -- the facade between raw keymap wiring and the actual events API", () => {
  it("is a pure translation: it never calls anything, only returns a plain command describing what the input means", () => {
    // (Structural sanity check, not a real assertion beyond the type shape --
    // the real guarantee is enforced by every other test in this file never
    // needing a SemanticShell, a FooterChatController, or a render.)
    const command = resolveShellCommand("\t", bodyFocused);
    expect(command).toEqual({ type: "focus-next" });
  });

  it("maps Tab/Shift+Tab to focus-next/focus-previous regardless of focus or footer availability", () => {
    expect(resolveShellCommand("\t", bodyFocused)).toEqual({ type: "focus-next" });
    expect(resolveShellCommand("\x1b[Z", bodyFocused)).toEqual({ type: "focus-previous" });
    expect(resolveShellCommand("\t", withoutFooterChat)).toEqual({ type: "focus-next" });
  });

  it("maps Ctrl+Right/Ctrl+Left to enter-fullscreen/exit-fullscreen regardless of focus -- SemanticShell itself decides whether entering is meaningful for the currently focused region, not this facade", () => {
    expect(resolveShellCommand("\x1b[1;5C", bodyFocused)).toEqual({ type: "enter-fullscreen" });
    expect(resolveShellCommand("\x1b[1;5D", bodyFocused)).toEqual({ type: "exit-fullscreen" });
    expect(resolveShellCommand("\x1b[1;5C", { focusedRegion: "header", hasFooterChat: false })).toEqual({ type: "enter-fullscreen" });
  });

  it("maps footer-scoped commands only when the footer is focused and a live footer chat exists", () => {
    expect(resolveShellCommand("\x1b[1;5A", withFooter)).toEqual({ type: "expand-footer" });
    expect(resolveShellCommand("\x1b[1;5B", withFooter)).toEqual({ type: "collapse-footer" });
    expect(resolveShellCommand("\r", withFooter)).toEqual({ type: "footer-submit" });
    expect(resolveShellCommand("\x7f", withFooter)).toEqual({ type: "footer-backspace" });
    expect(resolveShellCommand("h", withFooter)).toEqual({ type: "footer-type", char: "h" });
  });

  it("suppresses every footer-scoped command when the footer isn't focused, even if a live footer chat exists", () => {
    expect(resolveShellCommand("\x1b[1;5A", bodyFocused)).toBeUndefined();
    expect(resolveShellCommand("\r", bodyFocused)).toBeUndefined();
    expect(resolveShellCommand("h", bodyFocused)).toBeUndefined();
  });

  it("suppresses every footer-scoped command when no live footer chat exists, even if the footer is focused", () => {
    expect(resolveShellCommand("\x1b[1;5A", withoutFooterChat)).toBeUndefined();
    expect(resolveShellCommand("\r", withoutFooterChat)).toBeUndefined();
    expect(resolveShellCommand("h", withoutFooterChat)).toBeUndefined();
  });

  it("decodes a Kitty CSI-u printable sequence the same as a legacy raw character", () => {
    // CSI-u for lowercase 'h' (codepoint 104), no modifiers.
    expect(resolveShellCommand("\x1b[104u", withFooter)).toEqual({ type: "footer-type", char: "h" });
  });

  it("returns undefined for unrecognized input", () => {
    expect(resolveShellCommand("\x1b[99~", withFooter)).toBeUndefined();
    expect(resolveShellCommand("", withFooter)).toBeUndefined();
  });
});
