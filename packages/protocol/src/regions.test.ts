import { describe, expect, it } from "vitest";
import { layoutWorldRegions, MIN_FOOTER_HEIGHT, RegionSchema, type EmptyWorldViewModel, type ReadyWorldViewModel } from "./regions.js";
import { appletId, panelId, surfaceId, windowId, workspaceId } from "./ids.js";
import type { Panel } from "./panel.js";

const emptyWorld: EmptyWorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

const TWO_SURFACES = [
	{ id: surfaceId("s1"), integrationId: "terminal" as never, title: "Terminal", status: "idle" as const, selected: false },
	{ id: surfaceId("s2"), integrationId: "editor" as never, title: "Editor", status: "idle" as const, selected: false },
];

function readyWorld(tile: ReadyWorldViewModel["workspaces"][number]["windows"][number]["tile"], surfaces = tile === null ? [] : TWO_SURFACES): ReadyWorldViewModel {
	const window = { id: windowId("w1"), title: "Window 1", active: true, tile, surfaces };
	return {
		state: "ready",
		activeWorkspaceId: workspaceId("ws1"),
		workspaces: [{ id: workspaceId("ws1"), title: "My Workspace", activeWindowId: window.id, windows: [window] }],
	};
}

describe("semantic Region protocol", () => {
  it.each([
    [40, 12],
    [80, 24],
    [120, 40],
  ])("lays out the closed five-region shell at %ix%i", (width, height) => {
    const result = layoutWorldRegions(emptyWorld, width, height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((region) => (region.kind === "panel" ? region.location : region.kind))).toEqual(["top", "left", "body", "right", "bottom"]);
    expect(result.value.map((region) => RegionSchema.safeParse(region).success)).toEqual([true, true, true, true, true]);
    expect(result.value).toMatchObject([
      { kind: "panel", location: "top", body: [{ appletId: "window-carousel", carousel: { state: "empty", windows: [] } }] },
      { kind: "panel", location: "left", body: [{ appletId: "workspace-nav", items: [] }] },
      { kind: "body", content: { state: "empty", watermark: "No workspace open" } },
      { kind: "panel", location: "right", body: [{ appletId: "integrations-nav", items: [] }] },
      { kind: "panel", location: "bottom", body: [{ appletId: "chat", chat: { state: "unavailable", reason: "no-active-agent-integration" } }] },
    ]);
  });

  it("tiles the viewport without overlap or escape", () => {
    const result = layoutWorldRegions(emptyWorld, 53, 17);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const occupied = new Set<string>();
    for (const region of result.value) {
      for (let row = region.rect.y; row < region.rect.y + region.rect.height; row++) {
        for (let column = region.rect.x; column < region.rect.x + region.rect.width; column++) {
          expect(row).toBeLessThan(17);
          expect(column).toBeLessThan(53);
          const key = `${row}:${column}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
    }
    expect(occupied.size).toBe(53 * 17);
  });

  it("fails closed below the minimum useful viewport", () => {
    expect(layoutWorldRegions(emptyWorld, 19, 8)).toMatchObject({ ok: false });
    expect(layoutWorldRegions(emptyWorld, 20, 7)).toMatchObject({ ok: false });
  });

  it("rejects a Region kind outside the closed union", () => {
    expect(RegionSchema.safeParse({ kind: "sidebar", rect: { x: 0, y: 0, width: 1, height: 1 } }).success).toBe(false);
  });

  it("projects the active Window's live tile and Surface titles into the body region when a Workspace is open", () => {
    const tile = { kind: "row" as const, children: [{ tile: { kind: "leaf" as const, surfaceId: surfaceId("s1") }, constraint: { kind: "fill" as const, weight: 1 } }, { tile: { kind: "leaf" as const, surfaceId: surfaceId("s2") }, constraint: { kind: "fill" as const, weight: 1 } }] };
    const result = layoutWorldRegions(readyWorld(tile), 80, 24);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const body = result.value.find((region) => region.kind === "body")!;
    expect(RegionSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      content: {
        state: "active",
        title: "My Workspace",
        tile,
        surfaces: [
          { id: surfaceId("s1"), title: "Terminal" },
          { id: surfaceId("s2"), title: "Editor" },
        ],
      },
    });
  });

  it("projects a null tile and empty Surface list when the active Window has no docked Surfaces", () => {
    const result = layoutWorldRegions(readyWorld(null), 80, 24);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const body = result.value.find((region) => region.kind === "body")!;
    expect(body).toMatchObject({ content: { state: "active", tile: null, surfaces: [] } });
  });

  it("grows the footer and shrinks header/body/pillars to match, when given a taller footerHeight", () => {
    const result = layoutWorldRegions(emptyWorld, 80, 24, 10);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const footer = result.value.find((region) => region.kind === "panel" && region.location === "bottom")!;
    const body = result.value.find((region) => region.kind === "body")!;
    expect(footer.rect).toEqual({ x: 0, y: 14, width: 80, height: 10 });
    expect(body.rect.height).toBe(24 - 1 - 10);
  });

  it("still tiles the viewport without overlap or escape at a non-default footerHeight", () => {
    const result = layoutWorldRegions(emptyWorld, 53, 20, 6);
    if (!result.ok) throw new Error(result.issues.join("; "));
    const occupied = new Set<string>();
    for (const region of result.value) {
      for (let row = region.rect.y; row < region.rect.y + region.rect.height; row++) {
        for (let column = region.rect.x; column < region.rect.x + region.rect.width; column++) {
          expect(row).toBeLessThan(20);
          expect(column).toBeLessThan(53);
          const key = `${row}:${column}`;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
    }
    expect(occupied.size).toBe(53 * 20);
  });

  it("rejects a footerHeight below MIN_FOOTER_HEIGHT, or one that would leave no room for content", () => {
    expect(layoutWorldRegions(emptyWorld, 80, 24, 2)).toMatchObject({ ok: false });
    expect(layoutWorldRegions(emptyWorld, 80, 24, 23)).toMatchObject({ ok: false });
    expect(layoutWorldRegions(emptyWorld, 80, 24, 1.5)).toMatchObject({ ok: false });
  });

  it("omitting footerHeight is identical to passing MIN_FOOTER_HEIGHT explicitly", () => {
    const implicit = layoutWorldRegions(emptyWorld, 80, 24);
    const explicit = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT);
    expect(implicit).toEqual(explicit);
  });

  describe("Panel-driven geometry", () => {
    function panel(overrides: Partial<Panel> = {}): Panel {
      return { id: panelId("footer"), location: "bottom", alignment: "start", offset: 0, thickness: MIN_FOOTER_HEIGHT, lengthMode: "fill", visibilityMode: "normal", startCap: null, endCap: null, body: [appletId("chat")], ...overrides };
    }

    it("an empty panels array reproduces today's exact default layout", () => {
      const withoutPanels = layoutWorldRegions(emptyWorld, 80, 24);
      const withEmptyPanels = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, []);
      expect(withEmptyPanels).toEqual(withoutPanels);
    });

    it("footerHeight always wins over a seeded bottom Panel's own thickness -- resize (Ctrl+Up/Down) must keep working regardless of Panel content", () => {
      const result = layoutWorldRegions(emptyWorld, 80, 24, 8, [panel({ thickness: 3 })]);
      if (!result.ok) throw new Error(result.issues.join("; "));
      const footer = result.value.find((region) => region.kind === "panel" && region.location === "bottom")!;
      const body = result.value.find((region) => region.kind === "body")!;
      expect(footer.rect).toEqual({ x: 0, y: 16, width: 80, height: 8 });
      expect(body.rect.height).toBe(24 - 1 - 8);
    });

    it("a non-bottom Panel's own thickness still applies -- only \"bottom\" is special-cased to footerHeight", () => {
      const result = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, [panel({ id: panelId("top-nav"), location: "top", thickness: 5, body: [appletId("window-carousel")] })]);
      if (!result.ok) throw new Error(result.issues.join("; "));
      const top = result.value.find((region) => region.kind === "panel" && region.location === "top")!;
      expect(top.rect).toEqual({ x: 0, y: 0, width: 80, height: 5 });
    });

    it("a left Panel's thickness changes Body's own x/width independently of the right pillar", () => {
      const result = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, [panel({ id: panelId("left-nav"), location: "left", thickness: 20, body: [appletId("workspace-nav")] })]);
      if (!result.ok) throw new Error(result.issues.join("; "));
      const left = result.value.find((region) => region.kind === "panel" && region.location === "left")!;
      const body = result.value.find((region) => region.kind === "body")!;
      expect(left.rect.width).toBe(20);
      expect(body.rect.x).toBe(20);
    });

    it("rejects two Panels occupying the same edge Location", () => {
      const result = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, [panel(), panel({ id: panelId("other-footer") })]);
      expect(result).toMatchObject({ ok: false });
    });

    it("a floating Panel reserves no strut -- it's excluded from the edge layout entirely", () => {
      const withFloating = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, [panel({ id: panelId("toast"), location: "floating", thickness: 5 })]);
      const withoutPanels = layoutWorldRegions(emptyWorld, 80, 24);
      expect(withFloating).toEqual(withoutPanels);
    });

    it("rejects Panel thicknesses that leave no room for Body", () => {
      const result = layoutWorldRegions(emptyWorld, 40, 12, MIN_FOOTER_HEIGHT, [panel({ location: "left", id: panelId("huge-left"), thickness: 39 })]);
      expect(result).toMatchObject({ ok: false });
    });

    it("a real Applet moved away from its default Location never also renders at that Location's own default fallback", () => {
      // chat's real Panel now lives at "right" -- "bottom" has no Panel of its
      // own, and must not fall back to DEFAULT_EDGE_APPLET_IDS's own "chat"
      // default, or chat would render twice at once.
      const result = layoutWorldRegions(emptyWorld, 80, 24, MIN_FOOTER_HEIGHT, [panel({ location: "right", thickness: 20 })]);
      if (!result.ok) throw new Error(result.issues.join("; "));
      const right = result.value.find((region) => region.kind === "panel" && region.location === "right")!;
      const bottom = result.value.find((region) => region.kind === "panel" && region.location === "bottom")!;
      expect(right).toMatchObject({ body: [{ appletId: "chat" }] });
      expect(bottom).toMatchObject({ body: [] });
    });
  });
});
