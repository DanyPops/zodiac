# Alignment application

The React 19 client for Alignment. A **Workspace** is its own independent Canvas -- never the same thing as a Conversation (see "Workspace vs. Conversation" below): a numbered, wrap-around **Window Carousel** (top) holds that Workspace's independent docking arrangements, the center is the active Window's docked Surfaces, a **Surface Templates pillar** (right) holds predefined and user-saved templates to pull into the center, and the **Conversation Chat Surface** is a floating overlay hidden by default -- summoned by the bottom screen edge or a keymap, not a docked tab.

## Workspace vs. Conversation

A Workspace is not a Conversation, and the left **Workspace Selection** pillar lists Workspaces, not Conversations -- a real distinction, not naming pedantry. A Conversation is a Surface (the Chat Surface) that can be **global** (floating, independent of any Workspace -- its default), **scoped inside a specific Workspace** while still floating there, or **docked** into one of that Workspace's Windows alongside its other Surfaces (`dockChat`/`undockChatToFloating`/`isChatDocked` in `workspace/model.ts`). Conflating the two was a real, live bug this codebase had: `Workspace` used to carry a `conversationId` field and there was only ever one Workspace, silently rebound to whichever Conversation happened to be selected -- the left pillar's list of "conversations" was really a Conversation picker standing in for a Workspace picker, which is why every unnamed Conversation showed the same undifferentiated "U" glyph (see the Doc `Alignment: Workspace is not a Conversation` for the full incident).

`workspace/workspace-catalog.tsx` is a **mock** Workspace registry, for now -- four entries (Bug, Metrics, Chat, PRs) with distinct glyph icons, each backed by its own independent `Workspace` (own Windows, own docking, own Chat visibility) via `useWorkspaceRegistry`. Switching which one is active in the pillar never resets another's state -- verified directly, not just claimed (`useWorkspaceRegistry.test.ts`). A real, persisted, user-creatable Workspace registry is future work; "Chat" here is a Workspace whose own primary docked content happens to be conversational, not the floating Conversation Chat Surface itself (that stays global and can hover over, or dock into, any of these four, "Chat" included).

**Known gap, disclosed rather than silently dropped**: the left pillar used to double as a Conversation picker; it no longer does, since it now lists Workspaces. There is currently no dedicated UI to choose which Conversation the global floating Chat shows besides the app's own auto-selected default (the first one loaded) -- `conversation.open` still exists as a command (invocable via the Command Palette with an explicit id) but has no bound key or visible picker surface right now.

## Development

```bash
npm run dev --workspace=@alignment/app
npm test --workspace=@alignment/app
npm run typecheck --workspace=@alignment/app
npm run lint --workspace=@alignment/app
npm run build --workspace=@alignment/app
npm run check:bundle-budget --workspace=@alignment/app
npm run test:e2e --workspace=@alignment/app

# All of the above, in order:
npm run verify --workspace=@alignment/app
```

ESLint (`eslint.config.js`) runs four layers on top of standard React/TypeScript checks, all scoped to keep type-aware linting fast (`parserOptions.projectService`, `.eslintcache` via `npm run lint`):

- **Architecture**: the Workspace/Conversation/graph domain core must stay framework-neutral (no React, no browser globals), and only a named allowlist of adapter files may reference `window`/`document`/`localStorage`/`fetch` directly -- everything else goes through a port (`ConversationClient`/`Preferences`/`ThemeController`).
- **Import graph** (`eslint-plugin-import-x`'s `no-cycle`): a circular import is almost always a Dependency-Inversion violation in disguise.
- **Interfaces**: object shapes are `interface`, not `type`; interface methods use property (arrow-function) syntax, not method shorthand, since method shorthand is unsoundly bivariant on its parameter types in TypeScript -- a real Liskov-substitution gap, not a style preference.
- **Maintainability** (`eslint-plugin-sonarjs`): cognitive complexity, duplicated logic, and collapsible conditionals -- structural signals a function is doing more than one job (Single Responsibility), not just a line count.

`npm run lint:ci` (used by `npm run verify`) runs the same rules with `--max-warnings 0` and no cache, for a clean authoritative result.

The development server binds `127.0.0.1:5173` with a strict port check. The Playwright suite starts an isolated fixture-backed server on port 4175. Neither command silently reuses an unrelated server.

### Port troubleshooting

If Vite reports ready but the browser receives a response from another process, check every listener rather than only one `localhost` address:

```bash
ss -ltnp '( sport = :5173 )'
```

Separate processes can bind IPv4 `127.0.0.1:5173` and IPv6 `[::1]:5173`; browsers and CLI clients can then reach different servers through the same `localhost` name. Stop the stale process and restart the strict development command.

## Keyboard model

Every application action has a command identifier and an inspectable binding. Mouse controls and shortcuts execute the same command. Hovering or focusing a command control reveals its active platform-formatted shortcut.

Default bindings include:

| Action | Binding |
|---|---|
| Command palette | `Mod+K` |
| Keyboard shortcuts | `Mod+/` |
| Toggle Workspace Selection | `Mod+B` |
| Focus Workspace Selection | `Mod+1` |
| Focus Window view | `Mod+2` |
| Next/previous Window | `Mod+PageDown` / `Mod+PageUp` |
| New Window | `Mod+Alt+N` |
| Toggle Chat | `Mod+.` |
| Browse Surface Templates | `Mod+Shift+K` |
| Open Visual DNA | `Mod+Shift+,` |
| Send message | `Mod+Enter` |
| Cycle theme | `Mod+Alt+L` |

Pulling a Surface Template into the center by mouse is one path, not the only one: `Mod+Shift+K` opens a keyboard-native, launcher-style flow -- filter the catalog by typing, pick a template, then pick where it docks (as a tab, or split in a direction), the same choice a drag on to an edge or a tab strip makes.

## Pillar tooltips: real portals, not CSS-absolute boxes

`PillarTooltip.tsx` wraps a glyph-pillar trigger in Radix's own `Tooltip.Root`/`Tooltip.Portal` (the same mechanism `CommandButton`'s own built-in tooltip already used) instead of a hand-rolled `position: absolute` box positioned relative to a `group relative` ancestor. That hand-rolled version had a real, live bug: a scrollable pillar list (`overflow-auto`, many entries) measures an absolutely positioned descendant's box for its own scrollable content area even while that descendant is invisible (`opacity-0` doesn't remove it from layout) -- a tooltip box sized for its label text, sitting just past the 56px collapsed pillar's right edge, silently produced a horizontal scrollbar on the pillar itself. A portal escapes that ancestor's overflow box entirely, by construction, not by tuning `overflow-x`.

Fixing this also surfaced a second, independent, pre-existing bug in `CommandButton` itself: wrapping it in `Tooltip.Trigger asChild` clones an `onClick` handler onto it at runtime (Radix's own tooltip-close behavior), bypassing `CommandButtonProps`' type entirely (Slot cloning isn't visible to TypeScript). The button's own `onClick={...execute...} {...props}` ordering let that runtime-injected handler silently *replace* command execution rather than compose with it -- the same collision any caller passing an explicit `onClick` prop would have hit. Fixed by destructuring `onClick` and composing it (call the incoming handler, then execute), matching Radix's own convention; a regression test in `CommandButton.test.tsx` reproduces the collision directly (an explicit `onClick` prop, no Radix involved) and was confirmed to fail without the fix before being trusted.

## Docking engine

The center's split/tab layout is `dockview-react` (MIT, zero runtime dependencies, real `react ^19.0.0` peer support -- verified against its own published peer range, not forced). It is lazy-loaded (`React.lazy`/`Suspense` in `App.tsx`): the core shell becomes interactive without waiting on it, since the docking engine is a real ~80kB gzip dependency. `npm run check:bundle-budget` tracks the initial (`entry*`) and combined (`total*`) gzip weight as separate budgets for exactly this reason -- see `scripts/bundle-budget.mjs`.

Dropping near an edge of an already-docked Surface splits the Window in that direction, with a debounced/idle-gated preview (own code, in `WindowDockview.tsx`'s `onWillShowOverlay` handler) so a fast pass over several drop zones doesn't flicker a highlight on every one it crosses. Dropping on a Surface's tab strip inserts a tab. A known gap: dragging a Surface Template from the pillar directly onto an *existing* tab strip to insert a tab is not covered end-to-end (dockview's external-drag acceptance API, `onUnhandledDragOver`, only confirmed reachable at the root/edge level during this implementation, not per-group) -- the tab-insertion placement itself is fully covered via click-to-dock and the keyboard picker's "As a tab" option instead.

Docked Surfaces, the Workspace Selection/Surface Templates pillars, and the Window Carousel all render with rounded corners via dockview-core's own `themeLightSpaced`/`themeAbyssSpaced` "Spaced" theme variants (a real built-in feature, not hand-rolled CSS) plus matching Tailwind `rounded-2xl` classes on the shell's own regions. The light "Spaced" theme's own tab text color fails WCAG AA contrast on its tab background (4.47:1, needs 4.5:1) -- overridden in `styles.css` with `!important`, required because that theme's CSS loads from a lazy chunk injected into `<head>` after the app's own stylesheet, so ordinary specificity isn't enough to win the cascade.

## Chat: peek, expand, and dockable

The floating Chat Surface starts collapsed ("peek") each time it's summoned: only the composer and the most recent reply, not the full transcript. Clicking the peek area expands to the full conversation; a header control collapses back.

Chat can also be docked into the active Window like any other Surface (a header control on the floating overlay), rather than always floating. Once docked, it renders an "Aware of: ..." line naming its sibling docked Surfaces in the same Window, kept live via `dockview`'s `updateParameters` as Surfaces are docked/undocked around it -- not a one-time snapshot. Closing its docked panel (or its own "Float" control) returns it to the floating overlay rather than discarding it.

## Black & white only, for now

The shell has no color highlight at all right now, by explicit request -- not just a dark-mode fix, the brand accent itself. `--color-gray-*` uses Tailwind's achromatic "neutral" palette (every swatch is exactly R=G=B), not Tailwind's default "gray" (cool-toned -- its 900 is `#111827`, where the blue channel visibly leads red and green). `--color-accent*` (previously a blue, `#0066cc`) is now the same neutral family: a single fixed `#737373` (chosen for >=4.3:1 contrast against light surfaces and >=3.2:1 against dark ones, so the two call sites that use it without a `dark:` variant -- the focus-visible outline and the focused-input border -- stay visible in both themes without one), with the bg/text tint-and-shade pairs around it picked per-pairing for real contrast (verified, not eyeballed).

The docking engine needed the same fix independently, twice: dockview-core's "Abyss" dark theme is literally navy/purple at its color roots (`#000c18`, `#1c1c2a`, `#2b2b4a`), and *every* built-in theme (including the light one) ships a literal `dodgerblue` for a paneview's active outline, plus Abyss's own purple active-resize-sash color. All overridden in `styles.css` to the same neutral `#737373`/neutral-scale values used everywhere else.

The Activity Surface's semantic status colors (success/danger/warning/info in `graph/observability-graph.ts`) are left as real color -- they carry actual meaning (event outcome), not decoration, and are a separate concern from this scoping. Its graph-edge line colors, which *are* meant to read as plain neutral connectors, were fixed the same way (`#a3a3a3`/`#d4d4d4`, not the old cool-toned `#9ca3af`/`#d1d5db`).

`src/palette.test.ts` reads `styles.css` directly and asserts every `--color-gray-*` and `--color-accent*` swatch, plus dockview's overridden defaults, are achromatic -- so this can't silently regress back to a hue.

## Visual DNA: Vibe and Corner Sharpness

A gear icon in the Workspace Selection footer (both expanded and collapsed) opens **Visual DNA** (`Mod+Shift+,`): two sliders that reshape the shell's own chrome, inspired directly by Excalidraw's sloppiness/roundness controls (`packages/excalidraw/components/Range.tsx`, `actionChangeSloppiness`) but re-scoped for a real, interactive application rather than freehand-drawn shapes.

- **Vibe** (Cartoon to Professional): line/divider weight, from a bold 3px at Cartoon to a crisp 1px at Professional. Scoped to the shell's own dividers (Workspace Selection's header/footer/label borders, the docked Chat panel's header, the floating Chat panel's own border) -- deliberately *not* a literal rough.js-style path jitter applied to real interactive content: warping a button or a line of text with an SVG displacement filter would visibly separate what's rendered from what's actually clickable, which is a real usability risk this feature isn't worth taking on a production tool's own controls.
- **Corner Sharpness** (Square to Circle): corner radius, 0px at Square up to 32px at Circle -- past half the shortest side of every glyph/button-sized element in the shell, so small elements become true circles (CSS clamps `border-radius` past 50% of a box automatically) while large panels read as generously rounded. Applies to the same set of elements documented as sharing one rounded-corner visual language: both pillars, the Window Carousel, the center "Window view", the floating Chat panel, and docked Surfaces (dockview's own `--dv-border-radius`/`--dv-tab-border-radius`/`--dv-dropdown-border-radius`, overridden the same `!important`-because-lazy-CSS-loads-later way as the contrast fix above, via a live CSS variable reference so a slider drag repaints dockview immediately).

Both values persist through the same Preferences port as everything else (`platform/visual-dna.ts` for the pure formulas/validation, `platform/visual-dna-style.ts` for the one adapter that actually touches `document`, `visual-dna-hooks.ts` for the React-facing hook) and default to exactly the shell's pre-existing look (`vibe: 100` → 1px, `cornerSharpness: 50` → 16px == the old `rounded-2xl`) -- turning the feature on changes nothing until a slider is actually moved.


## Window Carousel: centered, fading with distance, and the mouse-wheel policy

The active Window's own button always sits horizontally centered in the Carousel's track (a coverflow effect, computed by the pure `computeWindowTrackOffsetPx` in `workspace/window-carousel-fade.ts` -- a CSS `left-1/2` anchor plus a `translateX` by that offset, not a scroll position). Its neighbors fade out with distance -- `computeWindowFadeOpacity` is a linear falloff from full opacity at the active Window to fully invisible (`opacity: 0`, not just dim) at `WINDOW_FADE_DISTANCE` (3) Windows away or further. Both are plain functions of index, unit-tested without a DOM, so `WindowCarousel.tsx` only wires them into inline `style` on each button.

Each mock Workspace (see "Mock Workspaces" below) starts pre-seeded with 7 empty Windows, centered on the middle one, purely so this effect is visible without first opening several Windows by hand (`createDemoWorkspace` in `workspace/workspace-catalog.tsx`) -- `useWorkspaceRegistry` itself still defaults to a real single-Window `createWorkspace` for any caller that doesn't pass a demo factory.

Direct clicks on a Window's number, and the keyboard commands (`window.next`/`window.previous`), wrap at both ends of the array. The mouse wheel is deliberately different: scrolling past either end opens exactly one new empty ("ephemeral") Window and moves into it, never a second one accumulating -- and if you scroll away from an empty Window without docking anything into it, it's dropped. A Window with real content docked into it is never pruned, active or not. See `scrollWindow` in `workspace/model.ts`. This prune check applies to *every* empty, inactive Window in one pass, not just the one immediately left -- so the mock demo Windows all disappear the first time the wheel is actually used while they're still empty, leaving only whichever Window has real content plus the freshly created one. That's the existing, correct ephemeral-Window policy working as designed; the demo seeding exists to show the Carousel's resting-state visual, not to survive real navigation.

## Chat matches the Carousel's width

The floating Chat overlay is positioned `absolute` inside the same `relative` center column as the Window Carousel and the canvas, not `fixed` to the viewport -- so it inherits that column's exact width (which itself already accounts for both pillars' current expanded/collapsed state) instead of carrying its own separate hardcoded max-width. Previously it used `fixed inset-x-0 bottom-0 mx-auto` with a `w-[min(48rem,...)]` cap, which made its width independent of -- and visually inconsistent with -- the Carousel directly above it.

## Keeping JSX and Tailwind classes readable

A few concrete patterns, applied where the shell's own conditional styling was starting to read as unbroken strings or duplicated map-loop bodies:

- **`platform/cn.ts`** joins conditional Tailwind fragments and resolves conflicting utilities (last one wins), replacing manual `` `base ${condition ? "a" : "b"}` `` template literals. Not a new invention -- the same small `twMerge`-backed helper already used in this workspace's `prototypes/ui-compat-lab`.
- **Extract a component, not a bigger ternary**: `WindowCarousel.tsx`'s per-index button (`WindowButton`) and `WorkspaceSelection.tsx`'s per-catalog-entry row (`ExpandedCatalogItem`/`CollapsedCatalogItem`) each own their own active/selected styling rule once, instead of that rule (and the whole `.map()` body) being duplicated at every render-list callsite.
- Early returns and small named booleans (`isActive`, `selected`) ahead of the returned JSX, rather than inlining the condition inside the className expression itself.
