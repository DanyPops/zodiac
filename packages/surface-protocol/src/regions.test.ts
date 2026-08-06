import { describe, expect, it } from "vitest";
import { layoutWorldRegions, RegionSchema, type EmptyWorldViewModel } from "./regions.js";

const emptyWorld: EmptyWorldViewModel = { state: "empty", workspaces: [], activeWorkspaceId: null };

describe("semantic Region protocol", () => {
  it.each([
    [40, 12],
    [80, 24],
    [120, 40],
  ])("lays out the closed five-region shell at %ix%i", (width, height) => {
    const result = layoutWorldRegions(emptyWorld, width, height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((region) => region.kind)).toEqual(["header", "pillar", "body", "pillar", "footer"]);
    expect(result.value.map((region) => RegionSchema.safeParse(region).success)).toEqual([true, true, true, true, true]);
    expect(result.value).toMatchObject([
      { kind: "header", carousel: { state: "empty", windows: [] } },
      { kind: "pillar", side: "left", navigation: "workspaces", items: [] },
      { kind: "body", content: { state: "empty", watermark: "No workspace open" } },
      { kind: "pillar", side: "right", navigation: "integrations", items: [] },
      { kind: "footer", chat: { state: "unavailable", reason: "no-active-agent-integration" } },
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
});
