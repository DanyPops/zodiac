# Alignment application

The React 19 client for Alignment. It renders Alef conversations inside a keyboard-first Workspace Canvas.

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
| Focus Workspace Canvas | `Mod+2` |
| Previous/next child surface | `Mod+Shift+[` / `Mod+Shift+]` |
| Send message | `Mod+Enter` |
| Cycle theme | `Mod+Alt+L` |
