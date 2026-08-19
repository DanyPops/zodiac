/**
 * Projects zodiacd's own visual-cue.propose Vehicle operation into a real Pi tool
 * (`propose_visual_cue`) -- the first Zodiac agent tool built the real Vehicle way
 * (registerVehicleTools), rather than hand-authored like zodiac_dispatch_command/
 * list_integrations (which predate this and stay unchanged).
 *
 * registerVehicleTools() needs a real ExtensionAPI, which createZodiacAgentSession's own
 * flat SDK `customTools` option doesn't provide -- resolved via @earendil-works/pi-coding-agent's
 * own DefaultResourceLoader({ extensionFactories }), a fully in-process, no-filesystem way to
 * hand a real ExtensionAPI to an inline factory (see docs/sdk.md's own "Extensions" section).
 * The returned ResourceLoader is meant to be passed straight into createZodiacAgentSession's own
 * `resourceLoader` option.
 */
import { registerVehicleTools, type RegisterVehicleToolsOptions } from "@danypops/vehicle-client-pi";
import type { VehicleClient, VehicleOperationDescriptor } from "@danypops/vehicle-core";
import { DefaultResourceLoader, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { VISUAL_CUE_PROPOSE_OPERATION_NAME } from "@zodiac/server/vehicle";

/**
 * Mirrors registerVehicleTools()'s own internal defaultToolName exactly (not exported from
 * vehicle-client-pi's public root, so reimplemented here rather than reached into an internal
 * module path) -- lowercase, non-alphanumeric runs collapsed to a single underscore, trimmed.
 * visual-cue.propose's own slugged name would be visual_cue_propose; renamed below to match this
 * whole story's established verb-first naming convention (list_integrations,
 * zodiac_dispatch_command). Every other operation this Vehicle ever registers keeps this same
 * bare slugging, unaffected.
 */
function slugifyOperationName(name: string, version: number, versioned: boolean): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!base) throw new Error(`Vehicle operation ${name}@${String(version)} has no valid Pi tool name`);
	return versioned ? `${base}_v${String(version)}` : base;
}

function toolNameFor(descriptor: VehicleOperationDescriptor, versioned: boolean): string {
	if (descriptor.name === VISUAL_CUE_PROPOSE_OPERATION_NAME) return "propose_visual_cue";
	return slugifyOperationName(descriptor.name, descriptor.version, versioned);
}

/**
 * Builds a ResourceLoader whose one inline extension projects `client`'s Vehicle operations as
 * real Pi tools via registerVehicleTools(). `client` is expected to be a LocalVehicleClient
 * wrapping zodiacd's own shared, in-process VehicleRegistry (constructed once at daemon startup)
 * -- never a fresh per-session registry, so approval/job state stays shared daemon-wide.
 *
 * Calls the loader's own reload() before returning it (matching docs/sdk.md's own documented
 * usage exactly) -- createAgentSession's own resourceLoader option expects an already-loaded
 * loader, not one a caller still has to remember to reload.
 */
export async function createVisualCueVehicleResourceLoader(client: VehicleClient, cwd: string, agentDir: string, options: RegisterVehicleToolsOptions = {}): Promise<ResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		extensionFactories: [
			{
				name: "zodiac-visual-cue",
				factory: async (pi) => {
					await registerVehicleTools(pi, client, { toolName: toolNameFor, ...options });
				},
			},
		],
	});
	await loader.reload();
	return loader;
}
