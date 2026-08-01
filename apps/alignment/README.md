# Alignment application

The React 19 client for Alignment. A **Workspace** is its own independent Canvas -- never the same thing as a Conversation (see below): a numbered, wrap-around **Window Carousel** (top) holds that Workspace's docking arrangements, the center is the active Window's docked Surfaces, a **Surface Templates pillar** (right) holds predefined and user-saved templates to pull into the center, and the **Conversation Chat Surface** is a floating overlay hidden by default -- summoned by the bottom screen edge or a keymap, not a docked tab.

## Workspace vs. Conversation

A Workspace is not a Conversation. The left **Workspace Selection** pillar lists Workspaces, not Conversations. A Conversation is a Surface (the Chat Surface) that can be **global** (floating, independent of any Workspace -- the default), **scoped inside a specific Workspace** while still floating, or **docked** into one of that Workspace's Windows (`dockChat`/`undockChatToFloating`/`isChatDocked` in `workspace/model.ts`).

`workspace/workspace-catalog.tsx` is a **mock** Workspace registry -- four entries (Bug, Metrics, Chat, PRs), each backed by its own independent `Workspace` (own Windows, own docking, own Chat visibility) via `useWorkspaceRegistry`. Switching the active one never resets another's state (`useWorkspaceRegistry.test.ts`). A real, persisted, user-creatable registry is future work. "Chat" here is a Workspace whose own docked content happens to be conversational -- distinct from the global floating Conversation Chat Surface, which can dock into any of the four.

Known gap: there is no dedicated UI to choose which Conversation the global floating Chat shows besides the app's own auto-selected default. `conversation.open` still exists as a command (Command Palette only) but has no bound key or picker surface.

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

ESLint (`eslint.config.js`) runs four layers on top of standard React/TypeScript checks, scoped to keep type-aware linting fast (`parserOptions.projectService`, `.eslintcache` via `npm run lint`):

- **Architecture**: the Workspace/Conversation/graph domain core stays framework-neutral (no React, no browser globals); only a named allowlist of adapter files may reference `window`/`document`/`localStorage`/`fetch` directly -- everything else goes through a port (`ConversationClient`/`Preferences`/`ThemeController`).
- **Import graph** (`eslint-plugin-import-x`'s `no-cycle`): a circular import is usually a Dependency-Inversion violation in disguise.
- **Interfaces**: object shapes are `interface`, not `type`; interface methods use property (arrow-function) syntax, not method shorthand, since method shorthand is unsoundly bivariant on its parameter types.
- **Maintainability** (`eslint-plugin-sonarjs`): cognitive complexity, duplicated logic, collapsible conditionals.

`npm run lint:ci` (used by `npm run verify`) runs the same rules with `--max-warnings 0` and no cache.

The development server binds `127.0.0.1:5173` with a strict port check. The Playwright suite starts an isolated fixture-backed server on port 4175. Neither command silently reuses an unrelated server.

### Port troubleshooting

If Vite reports ready but the browser receives a response from another process, check every listener rather than only one `localhost` address:

```bash
ss -ltnp '( sport = :5173 )'
```

Separate processes can bind IPv4 `127.0.0.1:5173` and IPv6 `[::1]:5173`. Stop the stale process and restart.

## Keyboard model

Every application action has a command identifier and an inspectable binding. Mouse controls and shortcuts execute the same command. Hovering or focusing a command control reveals its shortcut.

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

`Mod+Shift+K` opens a keyboard-native flow for docking a Surface Template: filter, pick a template, pick where it docks (tab, or split in a direction) -- the same choice a drag makes.

## Pillar tooltips

`PillarTooltip.tsx` renders through Radix's `Tooltip.Root`/`Tooltip.Portal` (same mechanism as `CommandButton`'s built-in tooltip), not a CSS-absolute box inside the scrollable pillar list -- a portal escapes the ancestor's overflow box, avoiding a phantom scrollbar a positioned-but-invisible tooltip element would otherwise cause.

`CommandButton` composes an externally-passed `onClick` with its own command execution (`onClick?.(event); registry.execute(...)`) rather than letting one silently replace the other -- required once anything (e.g. Radix's `Tooltip.Trigger asChild`) clones its own `onClick` onto the button at runtime.

## Docking engine

The center's split/tab layout is `dockview-react` (MIT, zero runtime dependencies, `react ^19.0.0` peer support). Lazy-loaded (`React.lazy`/`Suspense` in `App.tsx`) since it's a real ~80kB gzip dependency; `npm run check:bundle-budget` tracks entry vs. total gzip weight as separate budgets (`scripts/bundle-budget.mjs`).

Dropping near an edge of an already-docked Surface splits the Window; a debounced/idle-gated preview (`WindowDockview.tsx`'s `onWillShowOverlay`) avoids flickering a highlight during a fast pass over several drop zones. Dropping on a tab strip inserts a tab. Known gap: dragging a template from the pillar directly onto an *existing* tab strip isn't covered end-to-end; click-to-dock and the keyboard picker's "As a tab" option are.

Docked Surfaces, both pillars, and the Window Carousel render with rounded corners via dockview-core's `themeLightSpaced`/`themeAbyssSpaced` variants plus matching Tailwind classes. The light theme's own tab text color failed WCAG AA (4.47:1, needs 4.5:1) -- overridden in `styles.css` with `!important`, since that theme's CSS loads from a lazy chunk injected after the app's own stylesheet.

## Chat: peek, expand, and dockable

The floating Chat Surface starts collapsed ("peek") each time it's summoned: only the composer and the most recent reply. Clicking the peek area expands to the full transcript; a header control collapses back.

Chat can also be docked into the active Window (a header control on the floating overlay). Once docked it renders an "Aware of: ..." line naming sibling docked Surfaces, kept live via `dockview`'s `updateParameters`. Closing its docked panel (or its "Float" control) returns it to the floating overlay.

Positioned `absolute` inside the same `relative` center column as the Window Carousel, not `fixed` to the viewport -- its width matches the Carousel's exactly, tracking both pillars' collapsed/expanded state.

## Black & white only, for now

No color highlight anywhere, by request -- covers the brand accent, not just dark mode. `--color-gray-*` uses Tailwind's achromatic "neutral" palette (every swatch R=G=B), not Tailwind's default "gray" (cool-toned). `--color-accent*` (previously `#0066cc`) is the same neutral family: a fixed `#737373`, meeting >=4.3:1 contrast against light surfaces and >=3.2:1 against dark ones for the two call sites that use it without a `dark:` variant.

dockview-core needed the same fix: the "Abyss" dark theme's color roots, plus a literal `dodgerblue` paneview-active-outline shipped in every built-in theme, all overridden to the same neutral values.

Semantic status colors (success/danger/warning/info in `graph/observability-graph.ts`) are left as real color -- they carry meaning, not decoration. Its plain connector-line colors were converted to true-neutral.

`src/palette.test.ts` reads `styles.css` directly and asserts every gray/accent swatch, plus dockview's overridden defaults, is achromatic.

## Visual DNA: Vibe and Corner Sharpness

A gear icon in the Workspace Selection footer opens **Visual DNA** (`Mod+Shift+,`): two sliders, inspired by Excalidraw's sloppiness/roundness controls but re-scoped for a real interactive application.

- **Vibe** (Cartoon to Professional): divider line weight, 3px to 1px. Not a rough.js-style path jitter -- warping a button's rendered position would desync it from its real hit box.
- **Corner Sharpness** (Square to Circle): corner radius, 0px to 32px -- past half the shortest side of every glyph-sized element, so small elements clamp into true circles. Applies to both pillars, the Window Carousel, the center view, floating Chat, and docked Surfaces (dockview's `--dv-border-radius`/etc., via a live CSS variable reference).

Persisted through the Preferences port (`platform/visual-dna.ts` for formulas, `platform/visual-dna-style.ts` for the one DOM-touching adapter, `visual-dna-hooks.ts` for the React hook). Defaults render pixel-identical to the shell's prior look.

## Window Carousel: centered, fading, and an infinite loop

The active Window sits horizontally centered (a coverflow effect). Each Window is positioned by `circularWindowDelta(index, activeIndex, windowCount)` in `workspace/window-carousel-fade.ts` -- the shortest *wrapped* distance from the active Window, so the Window before index 0 is the last one (delta -1), not maximally far away. `computeWindowOffsetPx(delta)` turns that into a pixel offset; `computeWindowFadeOpacity(delta)` fades it out, linearly, to fully invisible (`opacity: 0`) at `WINDOW_FADE_DISTANCE` (3) Windows away.

Each mock Workspace starts pre-seeded with 7 empty Windows, centered on the middle one, so this is visible at rest (`createDemoWorkspace` in `workspace/workspace-catalog.tsx`) -- `useWorkspaceRegistry` itself still defaults to a real single-Window `createWorkspace`.

Clicks, keyboard commands, and the mouse wheel are all the same wrap-around ring (`scrollWindow` in `workspace/model.ts` delegates to `nextWindow`/`previousWindow`). Nothing is created or pruned by navigating; explicit Window creation is via `window.new`/the New Window button only.

The wheel listener is attached natively via ref/effect, not React's `onWheel` prop: React attaches wheel listeners as passive, so `preventDefault()` inside `onWheel` is silently ignored and the browser's own default scroll still fires alongside ours. `{ passive: false }` is the only way around that.

Wheel distance accumulates across events rather than stepping once per raw event: a trackpad reports one physical swipe as dozens of small events, and stepping on every one spun the carousel through several Windows for a single gentle gesture. `WindowCarousel.tsx` only advances once `WHEEL_STEP_THRESHOLD_PX` (50) of accumulated distance is crossed, capped at one step per event so a single large delta (a real mouse wheel notch) still advances exactly one Window. A gap longer than `WHEEL_GESTURE_IDLE_RESET_MS` (400ms) starts a fresh gesture.

## Keeping JSX and Tailwind classes readable

- **`platform/cn.ts`** joins conditional Tailwind fragments and resolves conflicting utilities (last one wins) -- the same small `twMerge`-backed helper already used in `prototypes/ui-compat-lab`.
- Extract a component, not a bigger ternary, when a styling rule is duplicated across a `.map()` or a collapsed/expanded pair (`WindowButton`, `ExpandedCatalogItem`/`CollapsedCatalogItem`).
- Early returns and named booleans (`isActive`, `selected`) ahead of the returned JSX, rather than inlining conditions in the className expression.
