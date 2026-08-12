# Alignment

Alignment presents Alef conversations and pooled SDLC data as composable Workspaces for human review and decision-making.

## Layout

```text
alignment/
├── apps/
│   ├── web/              Web client (React) -- @alignment/web
│   └── terminal/         Terminal client -- @alignment/terminal (its own installed CLI command
│                        stays `alignment-tui`, unchanged -- a published binary name, a separate
│                        decision from this internal package/directory naming pass)
├── packages/
│   ├── server/           Framework-neutral domain core (Workspace/World) -- @alignment/server,
│   │                      destined to be owned by a real daemon (`alignmentd`); today each
│   │                      client still instantiates its own in-memory copy directly.
│   ├── pi-integration/   Adapter to the Pi coding-agent process -- @alignment/pi-integration
│   └── protocol/         Wire-level schemas/types, framework-agnostic -- @alignment/protocol
└── prototypes/           isolated compatibility experiments
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev --workspace=@alignment/web
npm run test:e2e --workspace=@alignment/web
```

The application reads Alef's local session store through a development-server adapter. Browser code receives opaque conversation identifiers and normalized events; it does not receive filesystem paths.
