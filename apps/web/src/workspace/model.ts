/**
 * One instance of a Surface Template docked into a Window's center. `id` is
 * unique per instance (a Window can dock the same template kind more than
 * once -- two Terminal surfaces, say), `templateId` names which entry in the
 * Surface Templates registry produced it.
 */
export interface DockedSurfaceInstance {
	id: string;
	templateId: string;
	title: string;
}

/** Identifies the docked Chat Surface among a Window's dockedSurfaces (see chat-docking.ts). */
export const CHAT_TEMPLATE_ID = "chat";
