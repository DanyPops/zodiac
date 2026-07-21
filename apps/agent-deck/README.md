# agent-deck

Part of the [alignment](../../README.md) monorepo. An ingestion-first client for
cross-functional alignment on top of the Alef/Pi agent ecosystem, rendered as a tiling
window-manager UI (dockview), running identically in a browser tab and as a native
Electron shell.

This is not "a chat client for backend X." It ingests from several independent,
asynchronous data sources — starting with Alef's own session JSONL trace files — into
a canonical `graphology` graph, and renders that graph through tiles (a conversation
timeline, an observability/trace graph, and more later).

See Papyrus docs and tasks for the design record and work breakdown:

- `concept-tiling-wm-ui-for-cross-functional-alignment-alef-pi--a2jd` — original concept
- `research-addendum-openclaw-pi-agent-ecosystem-prior-art-0mga` — OpenClaw/pi ecosystem research
- `decision-wire-into-alef-via-session-jsonl-tail-observability-zdq1` — this project's architecture decision

## Status

Walking skeleton in progress: ingestion (JSONL tail), graph model (graphology), theme
(Tailwind, dark/light/system), and dockview shell are done. Conversation-tile content
rendering and the sigma.js observability tile are next.

## Development

```bash
npm run dev      # from this directory, or `npm run dev --workspace=agent-deck` from the repo root
npm test
npm run typecheck
```
