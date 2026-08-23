/**
 * Task 8facba42's own real guard: an async LLM title-generation round trip
 * can resolve well after the Workspace it names stopped being one this
 * client still tracks (a page navigation, or a removal, while it was in
 * flight) -- firing workspace.rename anyway just gets it rejected by the
 * daemon for an id it never has. `catalog` is App.tsx's own combined
 * pending+confirmed list (its own single source of "known to this client").
 */
export function shouldApplyLlmRename(catalog: readonly { readonly id: string }[], workspaceId: string): boolean {
	return catalog.some((entry) => entry.id === workspaceId);
}
