# alignment

Cross-functional alignment on top of the Alef/Pi agent ecosystem — a
monorepo, not a single app. This is the home for everything under the
`tiling-wm-ui-for-cross-functional-alignment` initiative.

## Layout

```
alignment/
├── apps/
│   └── agent-deck/    the ingestion-first client: tails Alef's session
│                       trace files (live or historical), builds a
│                       graphology trace graph, renders it through a
│                       dockview tiling shell (Conversation + Observability
│                       tiles), dark/light/system theme
└── packages/          shared libraries, once something needs to be
                        shared across more than one app (empty for now)
```

## Development

Each app/package is an npm workspace member with its own scripts. From the
root:

```bash
npm install          # installs and links all workspace members
npm test              # runs tests in every workspace that has a test script
npm run typecheck      # typechecks every workspace
```

Or work within a single app directly:

```bash
cd apps/agent-deck
npm run dev
```

## Provenance

`apps/agent-deck` was originally scaffolded as a standalone repository at
`~/Workspace/agent-deck` before being folded into this monorepo — full git
history was preserved across the move (`git log --follow` on any file under
`apps/agent-deck/` shows its pre-move commits).

See Papyrus docs for the design record:

- `concept-tiling-wm-ui-for-cross-functional-alignment-alef-pi--a2jd` — original concept
- `research-addendum-openclaw-pi-agent-ecosystem-prior-art-0mga` — OpenClaw/pi ecosystem research
- `decision-wire-into-alef-via-session-jsonl-tail-observability-zdq1` — agent-deck's architecture decision
- `design-tokens-red-hat-informed-not-red-hat-branded-rm7c` — visual design tokens
