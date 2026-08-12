# Zodiac

Zodiac presents Alef conversations and pooled SDLC data as composable Workspaces for human review and decision-making.

## Layout

```text
zodiac/
├── apps/
│   ├── web/              Web client (React) -- @zodiac/web
│   └── terminal/         Terminal client -- @zodiac/terminal, its own installed CLI command
│                         `zodiac-tui` (renamed from `alignment-tui` alongside the rest of
│                         the Alignment -> Zodiac rename -- a real, published-binary-name
│                         breaking change, not just internal repo layout)
├── packages/
│   ├── server/           Framework-neutral domain core (Workspace/World) -- @zodiac/server,
│   │                      destined to be owned by a real daemon (`zodiacd`); today each
│   │                      client still instantiates its own in-memory copy directly.
│   ├── agent/            The driven AgentIntegrationPort/ZodiacAgentEvent port -- @zodiac/agent,
│   │                      deliberately Pi-SDK-neutral (no @earendil-works/pi-coding-agent or
│   │                      @danypops/pi-rpc-protocol dependency): a caller that only needs the
│   │                      port type never pulls in either Pi SDK.
│   ├── pi/               Concrete Pi adapters implementing @zodiac/agent's port, in-process
│   │                      and subprocess -- @zodiac/pi.
│   └── protocol/         Wire-level schemas/types, framework-agnostic -- @zodiac/protocol
└── prototypes/           isolated compatibility experiments
```

## Development

```bash
npm install       # once, or after pulling a dependency change
npm run dev       # bring up the web client (@zodiac/web) at http://127.0.0.1:5173
npm run terminal  # build and launch the terminal client (@zodiac/terminal) against the cwd
```

Every other everyday command is a plain root-level npm script -- run from the repo root, no
`--workspace=` flag to remember:

| Command | What it does |
| --- | --- |
| `npm test` | Runs every workspace's own test suite. |
| `npm run test:system` | Runs `@zodiac/web`'s Playwright system-test suite (extra args forward through, e.g. `npm run test:system -- --list`). |
| `npm run typecheck` | `tsc --noEmit` across every workspace. |
| `npm run lint` / `lint:ci` | ESLint across every workspace that has it (`lint:ci` is `--max-warnings 0`, what CI runs). |
| `npm run build` | Production build of every workspace that has one. |
| `npm run verify` | The one "did I break anything" gate: typecheck -> lint:ci -> test -> build, stopping at the first failure. |
| `npm run verify:full` | `verify`, plus `@zodiac/web`'s system-test suite and its bundle-budget check -- slower, closer to what a release needs. |
| `npm run clean` | Removes every workspace's own build/test output and lint cache (dist/, test-results/, playwright-report/, .eslintcache) -- never node_modules. |
| `npm run reinstall` | The "something's actually broken" nuke: removes node_modules and package-lock.json, then reinstalls clean. |

The application reads Alef's local session store through a development-server adapter. Browser code receives opaque conversation identifiers and normalized events; it does not receive filesystem paths.
