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
npm install
npm test
npm run typecheck
npm run build
npm run dev --workspace=@zodiac/web
npm run test:e2e --workspace=@zodiac/web
```

The application reads Alef's local session store through a development-server adapter. Browser code receives opaque conversation identifiers and normalized events; it does not receive filesystem paths.
