export type { Brand, WorldId, WorkspaceId, WindowId, SurfaceId, IntegrationId, VerticalId, CommandId, ResourceId, PanelId, AppletId } from "./ids.js";
export { WorldIdSchema, WorkspaceIdSchema, WindowIdSchema, SurfaceIdSchema, IntegrationIdSchema, VerticalIdSchema, CommandIdSchema, ResourceIdSchema, PanelIdSchema, AppletIdSchema, worldId, workspaceId, windowId, surfaceId, integrationId, verticalId, commandId, resourceId, panelId, appletId } from "./ids.js";

export type { ParseResult } from "./result.js";
export { parseWithSchema } from "./result.js";

export type { ResourceStatus, Provenance, SelectionState, FocusState } from "./status.js";
export { ResourceStatusSchema, ProvenanceSchema, SelectionStateSchema, FocusStateSchema } from "./status.js";

export type { Resource, Surface, WorkspaceWindow, Workspace, World, IntegrationCapabilities, IntegrationDefinition, Vertical } from "./entities.js";
export { ResourceSchema, SurfaceSchema, WorkspaceWindowSchema, WorkspaceSchema, WorldSchema, IntegrationCapabilitiesSchema, IntegrationDefinitionSchema, VerticalSchema, MAX_INTEGRATIONS_PER_VERTICAL } from "./entities.js";

export type { CommandIntent } from "./commands.js";
export { CommandIntentSchema, COMMAND_INTENT_PROTOCOL_VERSION, COMMAND_INTENT_MIN_VERSION, isSupportedCommandIntent } from "./commands.js";
export type { EditorOpenClientAction } from "./client-actions.js";
export { EditorOpenClientActionSchema, MAX_CLIENT_ACTION_PATH_BYTES, MAX_CLIENT_ACTION_HASH_BYTES, MAX_CLIENT_ACTION_POSITION } from "./client-actions.js";

export type { SurfaceViewModel, WindowViewModel, WorkspaceViewModel } from "./view-models.js";
export { SurfaceViewModelSchema, WindowViewModelSchema, WorkspaceViewModelSchema } from "./view-models.js";
export type { PickerItem, PickerRequest } from "./ui-results.js";

export type { Constraint, TileChild, SurfaceTile } from "./tile.js";
export { ConstraintSchema, SurfaceTileSchema, MAX_TILE_DEPTH, MAX_CHILDREN_PER_TILE, MAX_SURFACES_PER_TILE } from "./tile.js";
export type { EmptyWorldViewModel, ReadyWorldViewModel, WorldViewModel, WorldChange, Region, AppletContent } from "./regions.js";
export { AppletContentSchema, WorldViewModelSchema, WorldChangeSchema } from "./regions.js";
export { MIN_FOOTER_HEIGHT, RegionRectSchema, RegionSchema, layoutWorldRegions } from "./regions.js";

export type { SurfaceRenderer } from "./renderer.js";

export type { VehicleSurfaceEvent, VehicleSurfaceEventDescriptor, VehicleSurfaceFailure, VehicleSurfaceInvokeRequest, VehicleSurfaceInvokeResult, VehicleSurfaceManifest, VehicleSurfaceOperation } from "./vehicle-surface.js";
export { VehicleSurfaceEventSchema, VehicleSurfaceEventDescriptorSchema, VehicleSurfaceFailureSchema, VehicleSurfaceInvokeRequestSchema, VehicleSurfaceInvokeResultSchema, VehicleSurfaceManifestSchema, VehicleSurfaceOperationSchema } from "./vehicle-surface.js";

export type { Location, EdgeLocation, PanelAlignment, FormFactor, LengthMode, VisibilityMode, AppletSlot, AppletDefinition, Panel, PanelThicknessUnit } from "./panel.js";
export { LocationSchema, EdgeLocationSchema, PanelAlignmentSchema, FormFactorSchema, LengthModeSchema, VisibilityModeSchema, AppletSlotSchema, AppletDefinitionSchema, PanelSchema, PanelThicknessUnitSchema, formFactorForLocation, validatePanelAppletAssignment } from "./panel.js";

export type {
  ZodiacContribution,
  ContributionCapability,
  ContributionCardinality,
  ContributionCommand,
  ContributionDescription,
  ContributionHost,
  ContributionOutcome,
  ContributionPointDefinition,
  ContributionPointKind,
  ContributionProvenance,
  ContributionReadBounds,
  ContributionResourceProvider,
  ContributionResourceReference,
} from "./contributions.js";
export {
  APPLET_CONTRIBUTION_POINT,
  ContributionCardinalitySchema,
  ContributionCommandDescriptionSchema,
  ContributionDescriptionSchema,
  ContributionInvokeRequestSchema,
  ContributionPointDefinitionSchema,
  ContributionPointKindSchema,
  ContributionProvenanceSchema,
  ContributionReadBoundsSchema,
  ContributionResourceReadRequestSchema,
  ContributionResourceReferenceSchema,
  EDITOR_CONTRIBUTION_POINT,
  VEHICLE_LOOPBACK_CONTRIBUTION_POINT,
  VEHICLE_SURFACE_CONTRIBUTION_POINT,
} from "./contributions.js";
// Compatibility alias, not dead weight: the vendored, unpublished
// @danypops/alignment-lector's own frozen source (repacked upstream, not
// ours to edit) does `import type { AlignmentContribution } from
// "@alignment/surface-protocol"` -- and the root package.json's own
// override resolves that literal package name to *this* package's real
// content (see apps/terminal/vendor/README.md for the full override
// story). A plain rename without this alias breaks that external import
// outright (a real, confirmed `tsc` error: "has no exported member
// 'AlignmentContribution'"), even though every one of *our own* call
// sites already uses ZodiacContribution. TypeScript's interfaces are
// structurally typed, so this costs nothing beyond the export line
// itself -- both names describe the exact same type.
export type { ZodiacContribution as AlignmentContribution } from "./contributions.js";

export type { DesktopHostPort, DesktopIpcFailureReason, DesktopIpcRequest, DesktopIpcResult, HostCapabilityClassification, HostCapabilityInventoryEntry } from "./host-port.js";
export { DESKTOP_RESOLVE_ZODIACD_BASE_URL_CHANNEL, DesktopIpcFailureReasonSchema, DesktopIpcRequestSchema, DesktopIpcResultSchema, HOST_CAPABILITY_INVENTORY } from "./host-port.js";
