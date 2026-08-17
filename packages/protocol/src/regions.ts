import { z } from "zod";
import { appletId, SurfaceIdSchema } from "./ids.js";
import type { AppletId, WorkspaceId } from "./ids.js";
import type { Location, Panel } from "./panel.js";
import type { ParseResult } from "./result.js";
import type { WorkspaceViewModel } from "./view-models.js";
import { SurfaceTileSchema } from "./tile.js";

export interface EmptyWorldViewModel { readonly state: "empty"; readonly workspaces: readonly []; readonly activeWorkspaceId: null }
export interface ReadyWorldViewModel { readonly state: "ready"; readonly workspaces: readonly WorkspaceViewModel[]; readonly activeWorkspaceId: WorkspaceId }
export type WorldViewModel = EmptyWorldViewModel | ReadyWorldViewModel;

export const RegionRectSchema = z.object({ x: z.number().int().nonnegative().max(500), y: z.number().int().nonnegative().max(300), width: z.number().int().positive().max(500), height: z.number().int().positive().max(300) });
const ItemSchema = z.object({ id: z.string().min(1), label: z.string().min(1).max(200), active: z.boolean() });

/**
 * One Applet's own rendered content, tagged by which real AppletId it's for
 * (packages/server/src/contribution/applet-registry.ts's built-in roster) --
 * the piece that used to be baked into a fixed Region `kind` (header always
 * meant carousel, footer always meant chat). A Panel region's `body` is an
 * ordered list of these, so which content shows up at a given edge Location
 * is exactly whatever Applets that Location's Panel currently carries, not
 * a hardcoded pairing.
 */
export const AppletContentSchema = z.discriminatedUnion("appletId", [
	z.object({ appletId: z.literal("window-carousel"), carousel: z.discriminatedUnion("state", [z.object({ state: z.literal("empty"), windows: z.tuple([]) }), z.object({ state: z.literal("ready"), windows: z.array(ItemSchema).max(64) })]) }),
	z.object({ appletId: z.literal("workspace-nav"), items: z.array(ItemSchema).max(256) }),
	z.object({ appletId: z.literal("integrations-nav"), items: z.array(ItemSchema).max(256) }),
	z.object({ appletId: z.literal("chat"), chat: z.discriminatedUnion("state", [z.object({ state: z.literal("unavailable"), reason: z.literal("no-active-agent-integration") }), z.object({ state: z.literal("ready"), integrationId: z.string().min(1) })]) }),
]);
export type AppletContent = z.infer<typeof AppletContentSchema>;

const EdgeLocationSchema = z.enum(["top", "bottom", "left", "right"]);

export const RegionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("panel"), location: EdgeLocationSchema, rect: RegionRectSchema, body: z.array(AppletContentSchema).max(8) }),
	z.object({
		kind: z.literal("body"),
		rect: RegionRectSchema,
		content: z.discriminatedUnion("state", [
			z.object({ state: z.literal("empty"), watermark: z.literal("No workspace open") }),
			z.object({
				state: z.literal("active"),
				title: z.string().min(1).max(200),
				tile: SurfaceTileSchema.nullable(),
				surfaces: z.array(z.object({ id: SurfaceIdSchema, title: z.string().min(1).max(200) })).max(64),
			}),
		]),
	}),
]);
export type Region = z.infer<typeof RegionSchema>;

/** A footer needs at least one content row plus its two border rows -- the original, and still default, fixed size. */
export const MIN_FOOTER_HEIGHT = 3;

/** The body region's content for an open Workspace: its title plus its active Window's live tile and Surface titles (or a null tile / empty list if that Window has no docked Surfaces yet). */
function activeBodyContent(workspace: WorkspaceViewModel) {
	const activeWindow = workspace.windows.find((window) => window.id === workspace.activeWindowId) ?? workspace.windows[0];
	return {
		state: "active" as const,
		title: workspace.title,
		tile: activeWindow?.tile ?? null,
		surfaces: activeWindow?.surfaces.map((surface) => ({ id: surface.id, title: surface.title })) ?? [],
	};
}

const DEFAULT_HEADER_THICKNESS = 1;

function defaultPillarThickness(width: number): number {
	return Math.max(13, Math.min(18, Math.floor(width / 4)));
}

type EdgeLocation = Exclude<Location, "floating">;

/** Today's real, single-instance content assignment, kept as the fallback for any edge Location with no explicit Panel -- the same pairing this codebase has always painted, just now data rather than a hardcoded region `kind`. */
const DEFAULT_EDGE_APPLET_IDS: Record<EdgeLocation, readonly AppletId[]> = {
	top: [appletId("window-carousel")],
	left: [appletId("workspace-nav")],
	right: [appletId("integrations-nav")],
	bottom: [appletId("chat")],
};

/** Builds one Applet's real AppletContent from the World's own live state -- the chat Applet always renders its placeholder "unavailable" state here (the live status is a presentation-only overlay threaded separately through SemanticShell.project's own footerChat parameter, never round-tripped through World/CommandIntent). An id this function doesn't know how to render (a future/unbuilt Applet) is filtered out by the caller, not an error -- see the built-in Applet roster's own "placeholder content is fine" precedent. */
function appletContentFor(id: AppletId, world: WorldViewModel): AppletContent | undefined {
	switch (id as string) {
		case "window-carousel": {
			const empty = world.state === "empty";
			return { appletId: "window-carousel", carousel: empty ? { state: "empty", windows: [] } : { state: "ready", windows: world.workspaces[0]!.windows.map((w) => ({ id: w.id, label: w.title, active: w.active })) } };
		}
		case "workspace-nav":
			return { appletId: "workspace-nav", items: world.workspaces.map((w) => ({ id: w.id, label: w.title, active: w.id === world.activeWorkspaceId })) };
		case "integrations-nav":
			return { appletId: "integrations-nav", items: [] };
		case "chat":
			return { appletId: "chat", chat: { state: "unavailable", reason: "no-active-agent-integration" } };
		default:
			return undefined;
	}
}

/** A real Panel's own AppletIds, startCap/body/endCap in that order. */
function bodyAppletIdsOfPanel(panel: Panel): readonly AppletId[] {
	return [...(panel.startCap ? [panel.startCap] : []), ...panel.body, ...(panel.endCap ? [panel.endCap] : [])];
}

/**
 * One Panel per edge Location -- see the "Precedent: desktop-shell Panel/Applet
 * prior art" Doc's own settled anatomy. Only top/bottom/left/right reserve
 * layout space (StrutManager's own real docked/floating distinction); a
 * "floating" Panel is skipped here, not an error -- it doesn't own a strut.
 */
function edgePanelsByLocation(panels: readonly Panel[]): ParseResult<Partial<Record<EdgeLocation, Panel>>> {
	const byLocation: Partial<Record<EdgeLocation, Panel>> = {};
	for (const panel of panels) {
		if (panel.location === "floating") continue;
		if (byLocation[panel.location]) return { ok: false, issues: [`more than one Panel occupies Location "${panel.location}" -- exactly one Panel per Location is the model`] };
		byLocation[panel.location] = panel;
	}
	return { ok: true, value: byLocation };
}

/**
 * `footerHeight` defaults to the original fixed size (MIN_FOOTER_HEIGHT) --
 * every existing caller that never passes it keeps today's exact layout.
 * A caller (the TUI's own Neovim/tmux-style expand/collapse) can request a
 * taller footer to show real conversation history instead of one status
 * line; the header/body/pillars shrink to make room, same as resizing any
 * other pane in a tiling layout.
 *
 * `panels`, when given, lets a real Panel at an edge Location override both
 * that edge's own thickness AND which Applets' content render there
 * (StrutManager::availableScreenRect's algorithm for the former; the
 * Panel's own startCap/body/endCap for the latter) -- a Location with no
 * matching Panel keeps today's hardcoded default for both. `footerHeight`
 * remains the footer's own thickness default whenever no "bottom" Panel is
 * given (e.g. AppletId 2's own default one-line "chat" content moving to a
 * different Location doesn't retroactively change what an unrelated
 * caller's own footerHeight argument means).
 */
export function layoutWorldRegions(world: WorldViewModel, width: number, height: number, footerHeight: number = MIN_FOOTER_HEIGHT, panels: readonly Panel[] = []): ParseResult<readonly Region[]> {
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || height < 8 || width > 500 || height > 300) return { ok: false, issues: [`viewport must be integer 20..500 x 8..300; received ${width}x${height}`] };
	if (!Number.isInteger(footerHeight) || footerHeight < MIN_FOOTER_HEIGHT || footerHeight > height - 2) return { ok: false, issues: [`footerHeight must be an integer ${MIN_FOOTER_HEIGHT}..${height - 2} for a ${height}-row viewport; received ${footerHeight}`] };
	const edgePanelsResult = edgePanelsByLocation(panels);
	if (!edgePanelsResult.ok) return edgePanelsResult;
	const edgePanels = edgePanelsResult.value;
	const headerThickness = edgePanels.top?.thickness ?? DEFAULT_HEADER_THICKNESS;
	const footerThickness = edgePanels.bottom?.thickness ?? footerHeight;
	const leftThickness = edgePanels.left?.thickness ?? defaultPillarThickness(width);
	const rightThickness = edgePanels.right?.thickness ?? defaultPillarThickness(width);
	const contentHeight = height - headerThickness - footerThickness;
	const bodyWidth = width - leftThickness - rightThickness;
	if (contentHeight < 1 || bodyWidth < 1) return { ok: false, issues: [`Panel thickness leaves no room for Body content in a ${width}x${height} viewport (header ${headerThickness}, footer ${footerThickness}, left ${leftThickness}, right ${rightThickness})`] };
	const rects = {
		top: { x: 0, y: 0, width, height: headerThickness },
		left: { x: 0, y: headerThickness, width: leftThickness, height: contentHeight },
		body: { x: leftThickness, y: headerThickness, width: bodyWidth, height: contentHeight },
		right: { x: width - rightThickness, y: headerThickness, width: rightThickness, height: contentHeight },
		bottom: { x: 0, y: height - footerThickness, width, height: footerThickness },
	};
	// An AppletId already explicitly placed by some real Panel must never also
	// get re-added by another Location's *default* fallback below -- e.g. once
	// "chat" has moved from its default "bottom" to a real Panel at "right",
	// "bottom" (now genuinely Panel-less) must render empty, not silently
	// duplicate "chat" there via DEFAULT_EDGE_APPLET_IDS.
	const explicitlyPlacedAppletIds = new Set<AppletId>();
	for (const panel of Object.values(edgePanels)) {
		if (panel) for (const id of bodyAppletIdsOfPanel(panel)) explicitlyPlacedAppletIds.add(id);
	}
	function panelBodyFor(location: EdgeLocation): AppletContent[] {
		const panel = edgePanels[location];
		const ids = panel ? bodyAppletIdsOfPanel(panel) : DEFAULT_EDGE_APPLET_IDS[location].filter((id) => !explicitlyPlacedAppletIds.has(id));
		return ids.map((id) => appletContentFor(id, world)).filter((content): content is AppletContent => content !== undefined);
	}
	const empty = world.state === "empty";
	const regions: Region[] = [
		{ kind: "panel", location: "top", rect: rects.top, body: panelBodyFor("top") },
		{ kind: "panel", location: "left", rect: rects.left, body: panelBodyFor("left") },
		{ kind: "body", rect: rects.body, content: empty ? { state: "empty", watermark: "No workspace open" } : activeBodyContent(world.workspaces[0]!) },
		{ kind: "panel", location: "right", rect: rects.right, body: panelBodyFor("right") },
		{ kind: "panel", location: "bottom", rect: rects.bottom, body: panelBodyFor("bottom") },
	];
	const parsed = z.array(RegionSchema).length(5).safeParse(regions);
	return parsed.success ? { ok: true, value: parsed.data } : { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };
}
