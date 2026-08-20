import { createEventBus } from "@zodiac/server";
import { createApprovalCenter, bridgeVehicleRegistryApprovals, type ApprovalCenter } from "@zodiac/server/approval";
import { registerVisualCueOperations } from "@zodiac/server/vehicle";
import { createVisualCueVehicleResourceLoader } from "@zodiac/pi";
import { HmacApprovalAuthority } from "@danypops/vehicle-server/approval-authority";
import { VehicleRegistry } from "@danypops/vehicle-server";
import { LocalVehicleClient } from "@danypops/vehicle-client/local";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { resolveZodiacAgentDir } from "@zodiac/server/pi-agent-dir";

export interface MonolithGovernance {
	/** The real ApprovalCenter, exposed so a future terminal-side notifications UI can subscribe to it -- unused today (no such UI exists yet), but this is the same object apps/service's own composition root builds, not a stub. */
	readonly approvalCenter: ApprovalCenter;
	/** The real, in-process VehicleClient this process's resourceLoader is wired to -- exposed for direct testability (invoking an operation and observing the approval gate without a full model-driven tool call) and for a future operation to reuse the same shared registry/authority. */
	readonly vehicleClient: LocalVehicleClient;
	/** Pi's own ResourceLoader for propose_visual_cue, wired against this process's real, in-process VehicleRegistry -- pass into createZodiacAgentSession's own `resourceLoader` option. */
	readonly resourceLoader: ResourceLoader;
	/** Tool names this resourceLoader actually contributes -- append to `initialActiveToolNames` (or omit initialActiveToolNames entirely to keep Pi's own unrestricted default, which already includes anything a resourceLoader contributes). */
	readonly toolNames: readonly string[];
}

/**
 * Builds the *same real governance object graph* apps/service/src/cli.ts's
 * own `main()` does (HmacApprovalAuthority shared between ApprovalCenter and
 * VehicleRegistry, `registerVisualCueOperations`, `configureApprovals`,
 * `bridgeVehicleRegistryApprovals`), entirely in-process and with zero
 * network -- the actual fix for Monolith mode's own governance gap (see the
 * "apps/terminal: explicit mode selection" Papyrus Task): a bare
 * `createWorldStore()` with no Approval Gate and no Vehicle wiring gave an
 * embedded agent session an ungated posture nobody chose on purpose.
 *
 * Deliberately does NOT wire `zodiac_dispatch_command`
 * (createAgentCommandTool) -- it's hardwired to an HTTP `daemonUrl` (see
 * packages/pi/src/agent-command-tool.ts's own `CreateAgentCommandToolOptions`),
 * which Monolith mode has none of by definition (zero listening sockets,
 * zero network, per this task's own three-mode table). `list_integrations`
 * itself no longer has this constraint after the "Reshape list_integrations"
 * Papyrus Task -- it's now a pure, daemonUrl-free function of an injected
 * `getAllIntegrations()` callback -- but Monolith mode still doesn't wire it
 * here, for a different, real reason: this process has no Integration
 * catalog source of its own to inject (no Workspace/WorldStore-derived
 * IntegrationDefinition list exists in Monolith mode today). `propose_visual_cue`'s own wiring
 * (`createVisualCueVehicleResourceLoader`) has no such constraint -- it
 * already takes a `LocalVehicleClient` directly, an ordinary in-process
 * object, never an HTTP endpoint -- which is exactly why it's the one Vehicle
 * operation Monolith mode can offer with full governance parity today.
 * Extending Workspace/Surface dispatch itself to Monolith mode (an
 * in-process variant of those two HTTP-bound tools) is real, separate,
 * future work, not this task's scope.
 *
 * Async because `createVisualCueVehicleResourceLoader` itself resolves the
 * agent dir before returning -- cli.ts's own call site already awaits
 * inside `main()`.
 */
export async function buildMonolithGovernance(cwd: string): Promise<MonolithGovernance> {
	const authority = new HmacApprovalAuthority();
	const bus = createEventBus();
	const approvalCenter = createApprovalCenter({ bus, authority });

	const vehicleRegistry = new VehicleRegistry({ name: "zodiac-tui", version: "1", description: "Zodiac terminal's own in-process (Monolith mode) Vehicle operations." });
	registerVisualCueOperations(vehicleRegistry);
	vehicleRegistry.configureApprovals({ authority });
	bridgeVehicleRegistryApprovals(vehicleRegistry, approvalCenter);
	const vehicleClient = new LocalVehicleClient(vehicleRegistry);

	const resourceLoader = await createVisualCueVehicleResourceLoader(vehicleClient, cwd, resolveZodiacAgentDir());

	return { approvalCenter, vehicleClient, resourceLoader, toolNames: ["propose_visual_cue"] };
}
