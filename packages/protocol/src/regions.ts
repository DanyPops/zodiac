import { z } from "zod";
import { SurfaceIdSchema } from "./ids.js";
import type { WorkspaceId } from "./ids.js";
import type { ParseResult } from "./result.js";
import type { WorkspaceViewModel } from "./view-models.js";
import { SurfaceTileSchema } from "./tile.js";

export interface EmptyWorldViewModel { readonly state: "empty"; readonly workspaces: readonly []; readonly activeWorkspaceId: null }
export interface ReadyWorldViewModel { readonly state: "ready"; readonly workspaces: readonly WorkspaceViewModel[]; readonly activeWorkspaceId: WorkspaceId }
export type WorldViewModel = EmptyWorldViewModel | ReadyWorldViewModel;

export const RegionRectSchema = z.object({ x: z.number().int().nonnegative().max(500), y: z.number().int().nonnegative().max(300), width: z.number().int().positive().max(500), height: z.number().int().positive().max(300) });
const ItemSchema = z.object({ id: z.string().min(1), label: z.string().min(1).max(200), active: z.boolean() });
export const RegionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("header"), rect: RegionRectSchema, carousel: z.discriminatedUnion("state", [z.object({ state: z.literal("empty"), windows: z.tuple([]) }), z.object({ state: z.literal("ready"), windows: z.array(ItemSchema).max(64) })]) }),
  z.object({ kind: z.literal("pillar"), side: z.enum(["left", "right"]), navigation: z.enum(["workspaces", "integrations"]), rect: RegionRectSchema, items: z.array(ItemSchema).max(256) }),
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
  z.object({ kind: z.literal("footer"), rect: RegionRectSchema, chat: z.discriminatedUnion("state", [z.object({ state: z.literal("unavailable"), reason: z.literal("no-active-agent-integration") }), z.object({ state: z.literal("ready"), integrationId: z.string().min(1) })]) }),
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

/**
 * `footerHeight` defaults to the original fixed size (MIN_FOOTER_HEIGHT) --
 * every existing caller that never passes it keeps today's exact layout.
 * A caller (the TUI's own Neovim/tmux-style expand/collapse) can request a
 * taller footer to show real conversation history instead of one status
 * line; the header/body/pillars shrink to make room, same as resizing any
 * other pane in a tiling layout.
 */
export function layoutWorldRegions(world: WorldViewModel, width: number, height: number, footerHeight: number = MIN_FOOTER_HEIGHT): ParseResult<readonly Region[]> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || height < 8 || width > 500 || height > 300) return { ok: false, issues: [`viewport must be integer 20..500 x 8..300; received ${width}x${height}`] };
  if (!Number.isInteger(footerHeight) || footerHeight < MIN_FOOTER_HEIGHT || footerHeight > height - 2) return { ok: false, issues: [`footerHeight must be an integer ${MIN_FOOTER_HEIGHT}..${height - 2} for a ${height}-row viewport; received ${footerHeight}`] };
  const pillar = Math.max(13, Math.min(18, Math.floor(width / 4)));
  const contentHeight = height - 1 - footerHeight;
  const rects = { header: { x: 0, y: 0, width, height: 1 }, left: { x: 0, y: 1, width: pillar, height: contentHeight }, body: { x: pillar, y: 1, width: width - pillar * 2, height: contentHeight }, right: { x: width - pillar, y: 1, width: pillar, height: contentHeight }, footer: { x: 0, y: height - footerHeight, width, height: footerHeight } };
  const empty = world.state === "empty";
  const regions: Region[] = [
    { kind: "header", rect: rects.header, carousel: empty ? { state: "empty", windows: [] } : { state: "ready", windows: world.workspaces[0]!.windows.map(w => ({ id: w.id, label: w.title, active: w.active })) } },
    { kind: "pillar", side: "left", navigation: "workspaces", rect: rects.left, items: world.workspaces.map(w => ({ id: w.id, label: w.title, active: w.id === world.activeWorkspaceId })) },
    { kind: "body", rect: rects.body, content: empty ? { state: "empty", watermark: "No workspace open" } : activeBodyContent(world.workspaces[0]!) },
    { kind: "pillar", side: "right", navigation: "integrations", rect: rects.right, items: [] },
    { kind: "footer", rect: rects.footer, chat: { state: "unavailable", reason: "no-active-agent-integration" } },
  ];
  const parsed = z.array(RegionSchema).length(5).safeParse(regions);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, issues: parsed.error.issues.map(issue => issue.message) };
}
