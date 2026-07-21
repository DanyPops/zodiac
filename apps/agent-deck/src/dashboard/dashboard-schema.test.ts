import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, emptyDashboard, migrateDashboard } from "./dashboard-schema.js";

describe("migrateDashboard", () => {
	it("returns an empty dashboard for garbage input rather than throwing", () => {
		expect(migrateDashboard(null)).toEqual(emptyDashboard());
		expect(migrateDashboard(undefined)).toEqual(emptyDashboard());
		expect(migrateDashboard("not an object")).toEqual(emptyDashboard());
		expect(migrateDashboard(42)).toEqual(emptyDashboard());
	});

	it("accepts a well-formed current-version layout unchanged", () => {
		const layout = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			panels: [{ id: "p1", type: "ci", title: "CI", gridPos: { x: 0, y: 0, w: 4, h: 3 } }],
		};
		expect(migrateDashboard(layout)).toEqual(layout);
	});

	it("treats unversioned data (schemaVersion 0 / missing) as migratable, not garbage", () => {
		const legacy = { panels: [{ id: "p1", type: "tickets", title: "Tickets", gridPos: { x: 0, y: 0, w: 4, h: 3 } }] };
		const migrated = migrateDashboard(legacy);
		expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(migrated.panels).toHaveLength(1);
	});

	it("drops individual panels that don't match the shape, instead of failing the whole load", () => {
		const mixed = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			panels: [{ id: "good", type: "ci", title: "CI", gridPos: { x: 0, y: 0, w: 4, h: 3 } }, { id: "bad-missing-gridpos", type: "ci", title: "CI" }, "not even an object", null],
		};
		const migrated = migrateDashboard(mixed);
		expect(migrated.panels).toHaveLength(1);
		expect(migrated.panels[0]!.id).toBe("good");
	});

	it("refuses to guess a future schema version it doesn't understand", () => {
		const fromTheFuture = { schemaVersion: CURRENT_SCHEMA_VERSION + 1, panels: [{ id: "p1", type: "ci", title: "CI", gridPos: { x: 0, y: 0, w: 4, h: 3 } }] };
		expect(migrateDashboard(fromTheFuture)).toEqual(emptyDashboard());
	});

	it("handles an empty panels array", () => {
		expect(migrateDashboard({ schemaVersion: CURRENT_SCHEMA_VERSION, panels: [] })).toEqual(emptyDashboard());
	});
});
