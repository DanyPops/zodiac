# agent-deck

An ingestion-first client for cross-functional alignment on top of the Alef/Pi agent
ecosystem, rendered as a tiling window-manager UI (dockview), running identically in
a browser tab and as a native Electron shell.

This is not "a chat client for backend X." It ingests from several independent,
asynchronous data sources — starting with Alef's own session JSONL trace files — into
a canonical `graphology` graph, and renders that graph through tiles (a conversation
timeline, an observability/trace graph, and more later).

See Papyrus docs and tasks for the design record and work breakdown:

- `concept-tiling-wm-ui-for-cross-functional-alignment-alef-pi--a2jd` — original concept
- `research-addendum-openclaw-pi-agent-ecosystem-prior-art-0mga` — OpenClaw/pi ecosystem research
- `decision-wire-into-alef-via-session-jsonl-tail-observability-zdq1` — this project's architecture decision

## Status

Early walking skeleton. Not yet runnable.
