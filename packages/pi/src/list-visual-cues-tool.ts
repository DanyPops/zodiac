// @zodiac/ui/cues, not the bare "@zodiac/ui" barrel -- this package (packages/pi)
// is Node-only, consumed by apps/service's own daemon process; @zodiac/ui's own
// main barrel eagerly re-exports React components (ConfirmDialog, DialogChrome,
// ...) alongside cues.ts, which has zero business being imported into a headless
// daemon. cues.ts itself is confirmed pure/DOM-free (zero React import of its
// own), so this subpath exists specifically to let a Node-only consumer reach it
// without dragging React along -- the same reasoning @zodiac/server's own
// subpath exports already established for the reverse (browser-safety) direction.
import type { RegisteredCue } from "@zodiac/ui/cues";
import { listCues } from "@zodiac/ui/cues";
import type { PendingClientActions } from "@zodiac/server/agent";
import { NoClientObservedError } from "@zodiac/server/agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * The Port every list_visual_cues concrete adapter implements -- named to
 * match this codebase's own existing WorldClientPort precedent
 * (packages/server/src/world/world-client-port.ts), per Alistair Cockburn's
 * Hexagonal Architecture ("There will typically be multiple adapters for
 * any one port... By making each application executable in headless mode
 * through APIs... they gained the ability to regression test their
 * applications with stand-alone automated test scripts."
 * alistair.cockburn.us/hexagonal-architecture).
 *
 * Presence/Awareness-shaped, not canonical/durable (see this task's own
 * Figma/Yjs Awareness citations): listCues() either resolves with whatever
 * a real Client reports right now, or rejects with NoClientObservedError --
 * two genuinely different outcomes, never conflated into a bare empty array
 * either way.
 */
export interface VisualCueClientPort {
	listCues(): Promise<readonly RegisteredCue[]>;
}

/**
 * Cockburn's own "headless mode... test and mock adapter" -- calls
 * @zodiac/ui's real registerCue/listCues/runCue logic directly, in-process,
 * in Node. Not a stub reimplementation: cues.ts's own logic is already
 * DOM-free, pure state (the Headless Component pattern -- Fowler;
 * Radix/Headless UI/Downshift/TanStack) -- this adapter reuses it verbatim,
 * it just has no real DOM to animate a cue against. Zero network, zero SSE,
 * fully deterministic -- the adapter every unit/integration test of
 * list_visual_cues' own tool-call behavior should inject.
 */
export function createHeadlessVisualCueClient(): VisualCueClientPort {
	return {
		async listCues() {
			return listCues();
		},
	};
}

/**
 * The production "graphical human interface" adapter (Cockburn's own
 * pairing with the headless one above): the daemon has already announced
 * this exact toolCallId as a real tool-call-start SSE event on the
 * conversation stream the Client already subscribes to -- no separate
 * announcement mechanism, no new ZodiacAgentEvent variant, reusing Pi's own
 * real per-call toolCallId as the correlation id (see
 * pending-client-actions.ts's own doc comment). This adapter's own
 * listCues() just registers the pending call and awaits it; a real Client,
 * on its own initiative, POSTs the result back once it sees the
 * announcement -- the same Client-initiated direction as every other
 * cross-process interaction in this codebase (CommandIntent dispatch, HITL
 * approval decisions), never inverted.
 */
export function createRemoteBrowserVisualCueClient(pendingClientActions: PendingClientActions, toolCallId: string, timeoutMs?: number): VisualCueClientPort {
	return {
		async listCues() {
			const result = await pendingClientActions.register(toolCallId, timeoutMs);
			return (result as { cues?: readonly RegisteredCue[] } | undefined)?.cues ?? [];
		},
	};
}

const ListVisualCuesArgsSchema = Type.Object({});

/**
 * Read-only discovery of every visual cue currently registered in the
 * Client's own live UI (see @zodiac/ui's registerCue) -- e.g. "which
 * gallery categories can I highlight/pulse/scroll to right now." Takes no
 * parameters: checked directly against every real cue-target user story in
 * this codebase (SurfaceTemplatesGallery's own CategoryCard) and none is
 * Workspace-scoped, so no workspaceId was added speculatively.
 *
 * clientFactory is injected per call (not a single shared client instance)
 * because RemoteBrowserVisualCueClient's own correlation id is this call's
 * own toolCallId, known only once execute() actually runs -- see
 * createRemoteBrowserVisualCueClient's own doc comment.
 */
export function createListVisualCuesTool(clientFactory: (toolCallId: string) => VisualCueClientPort): ToolDefinition<typeof ListVisualCuesArgsSchema> {
	return {
		name: "list_visual_cues",
		label: "List Visual Cues",
		description: "Read-only: reports every visual cue currently registered in the Client's own live UI right now (e.g. which gallery categories can be highlighted/pulsed/scrolled to). Never mutates anything.",
		parameters: ListVisualCuesArgsSchema,
		async execute(toolCallId) {
			const client = clientFactory(toolCallId);
			try {
				const cues = await client.listCues();
				return {
					content: [{ type: "text", text: `${cues.length} visual cue(s) currently registered.` }],
					details: { observed: true, cues },
				};
			} catch (error) {
				if (error instanceof NoClientObservedError) {
					return {
						content: [{ type: "text", text: "No Client is currently connected to report visual cues from." }],
						details: { observed: false, cues: [] },
					};
				}
				throw error;
			}
		},
	};
}
