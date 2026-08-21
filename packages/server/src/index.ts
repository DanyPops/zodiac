export type { CommandDefinition, KeybindingDefinition, CommandDispatcher, CommandDispatcherOptions } from "./command/dispatcher.js";
export { createCommandDispatcher } from "./command/dispatcher.js";

export type { ContributionApi, Contribution, ContributionRegistry } from "./contribution/registry.js";
export { createContributionRegistry } from "./contribution/registry.js";
export type { ContributionPointMap, ContributionPointRegistry, RegisteredContribution } from "./contribution/point-registry.js";
export { ContributionCardinalityError, createContributionPointRegistry } from "./contribution/point-registry.js";
export type { ActiveContribution, EditorContributionRegistration, ExecutionStrategy } from "./contribution/execution-strategy.js";
export { createInProcessExecutionStrategy } from "./contribution/execution-strategy.js";

export type { AppletRegistry } from "./contribution/applet-registry.js";
export { createAppletRegistry, seedBuiltinApplets } from "./contribution/applet-registry.js";

export { createIdSequence, highestIdSuffix } from "./world/id-sequence.js";

export type { BusChannelName, BusMessage, BusMessageInput, BusHandler, Unsubscribe, BusListenerLimitExceeded, BusSubscribeResult, EventBus, EventBusOptions } from "./event/bus.js";
export { BUS_CHANNELS, WILDCARD_TYPE, createEventBus } from "./event/bus.js";

// pi-agent-dir.ts is deliberately NOT re-exported here: it imports node:fs/
// node:os at module scope, and this barrel is also the one apps/web's
// browser bundle imports from (createContributionRegistry, createCommandDispatcher,
// highestIdSuffix, ...). Vite's dev server evaluates a whole ES module on
// import regardless of which named export is actually used, so re-exporting
// pi-agent-dir here previously crashed the entire browser app at import time
// ("node:fs has been externalized for browser compatibility") before React
// ever rendered -- the app got stuck on its static loading placeholder with
// no visible error. Node-only consumers (packages/pi-integration,
// apps/terminal) import it from the "@zodiac/server/pi-agent-dir" subpath
// instead -- see that package's exports map.

// world/store.ts is also deliberately excluded, for a bundle-weight reason
// rather than a crash: it pulls in zod (via @zodiac/protocol's branded id
// schemas), and nothing apps/web actually calls (createContributionRegistry,
// createCommandDispatcher, highestIdSuffix) needs it -- confirmed via a real
// bundle-visualizer trace, not assumed. Import it from the
// "@zodiac/server/world" subpath instead (apps/terminal's cli.ts does).

// approval/approval-center.ts is excluded for the same crash reason as
// pi-agent-dir.ts: @danypops/vehicle-server/approval-authority imports
// node:crypto at module scope. zodiacd (apps/service, real Node) is the only
// intended consumer -- import it from the "@zodiac/server/approval" subpath
// there. apps/web's NotificationsPill only ever needs the *type* shapes
// (VehicleApprovalRequest/VehicleApprovalOutcome from @danypops/vehicle-core,
// itself dependency-free), which `import type` erases before bundling --
// never the ApprovalCenter runtime module itself.
