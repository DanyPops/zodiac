export type { CommandDefinition, KeybindingDefinition, CommandDispatcher, CommandDispatcherOptions } from "./command/dispatcher.js";
export { createCommandDispatcher } from "./command/dispatcher.js";

export type { ContributionApi, Contribution, ContributionRegistry } from "./contribution/registry.js";
export { createContributionRegistry } from "./contribution/registry.js";

export type { WorldStore } from "./world/store.js";
export { createWorldStore, createWorldStoreFromWorld, hydrateWorldStore } from "./world/store.js";

export type { WorldSnapshotPort } from "./world/snapshot-port.js";

export { createIdSequence, highestIdSuffix } from "./world/id-sequence.js";

// pi-agent-dir.ts is deliberately NOT re-exported here: it imports node:fs/
// node:os at module scope, and this barrel is also the one apps/web's
// browser bundle imports from (createContributionRegistry, createCommandDispatcher,
// highestIdSuffix, ...). Vite's dev server evaluates a whole ES module on
// import regardless of which named export is actually used, so re-exporting
// pi-agent-dir here previously crashed the entire browser app at import time
// ("node:fs has been externalized for browser compatibility") before React
// ever rendered -- the app got stuck on its static "Loading Alignment..."
// placeholder with no visible error. Node-only consumers (packages/pi-integration,
// apps/terminal) import it from the "@zodiac/server/pi-agent-dir" subpath
// instead -- see that package's exports map.
