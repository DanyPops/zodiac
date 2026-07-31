# Alignment application

The React 19 client for Alignment. A Workspace is its Canvas: a numbered, wrap-around **Window Carousel** (top) holds independent docking arrangements, the center is the active Window's docked Surfaces, a **Surface Templates pillar** (right) holds predefined and user-saved templates to pull into the center, and the **Conversation Chat Surface** is a floating overlay hidden by default -- summoned by the bottom screen edge or a keymap, not a docked tab.

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
| Send message | `Mod+Enter` |
| Cycle theme | `Mod+Alt+L` |

Pulling a Surface Template into the center by mouse is one path, not the only one: `Mod+Shift+K` opens a keyboard-native, launcher-style flow -- filter the catalog by typing, pick a template, then pick where it docks (as a tab, or split in a direction), the same choice a drag on to an edge or a tab strip makes.

## Docking engine

The center's split/tab layout is `dockview-react` (MIT, zero runtime dependencies, real `react ^19.0.0` peer support -- verified against its own published peer range, not forced). It is lazy-loaded (`React.lazy`/`Suspense` in `App.tsx`): the core shell becomes interactive without waiting on it, since the docking engine is a real ~80kB gzip dependency. `npm run check:bundle-budget` tracks the initial (`entry*`) and combined (`total*`) gzip weight as separate budgets for exactly this reason -- see `scripts/bundle-budget.mjs`.

Dropping near an edge of an already-docked Surface splits the Window in that direction, with a debounced/idle-gated preview (own code, in `WindowDockview.tsx`'s `onWillShowOverlay` handler) so a fast pass over several drop zones doesn't flicker a highlight on every one it crosses. Dropping on a Surface's tab strip inserts a tab. A known gap: dragging a Surface Template from the pillar directly onto an *existing* tab strip to insert a tab is not covered end-to-end (dockview's external-drag acceptance API, `onUnhandledDragOver`, only confirmed reachable at the root/edge level during this implementation, not per-group) -- the tab-insertion placement itself is fully covered via click-to-dock and the keyboard picker's "As a tab" option instead.

Docked Surfaces, the Workspace Selection/Surface Templates pillars, and the Window Carousel all render with rounded corners via dockview-core's own `themeLightSpaced`/`themeAbyssSpaced` "Spaced" theme variants (a real built-in feature, not hand-rolled CSS) plus matching Tailwind `rounded-2xl` classes on the shell's own regions. The light "Spaced" theme's own tab text color fails WCAG AA contrast on its tab background (4.47:1, needs 4.5:1) -- overridden in `styles.css` with `!important`, required because that theme's CSS loads from a lazy chunk injected into `<head>` after the app's own stylesheet, so ordinary specificity isn't enough to win the cascade.

## Chat: peek, expand, and dockable

The floating Chat Surface starts collapsed ("peek") each time it's summoned: only the composer and the most recent reply, not the full transcript. Clicking the peek area expands to the full conversation; a header control collapses back.

Chat can also be docked into the active Window like any other Surface (a header control on the floating overlay), rather than always floating. Once docked, it renders an "Aware of: ..." line naming its sibling docked Surfaces in the same Window, kept live via `dockview`'s `updateParameters` as Surfaces are docked/undocked around it -- not a one-time snapshot. Closing its docked panel (or its own "Float" control) returns it to the floating overlay rather than discarding it.

## Window Carousel: the mouse-wheel policy

Direct clicks on a Window's number, and the keyboard commands (`window.next`/`window.previous`), wrap at both ends of the array. The mouse wheel is deliberately different: scrolling past either end opens exactly one new empty ("ephemeral") Window and moves into it, never a second one accumulating -- and if you scroll away from an empty Window without docking anything into it, it's dropped. A Window with real content docked into it is never pruned, active or not. See `scrollWindow` in `workspace/model.ts`.
