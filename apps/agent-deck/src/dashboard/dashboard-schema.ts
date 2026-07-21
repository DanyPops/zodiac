/**
 * Persisted Dashboard layout schema, modeled directly on Grafana's real
 * dashboard JSON (read from ~/Repositories/grafana/public/app/features/
 * dashboard/state/{DashboardModel,PanelModel}.ts): a schemaVersion plus a
 * flat list of panels, each with a grid position in grid units (not pixels)
 * and a type identifying which renderer owns it. Grafana pairs this with a
 * DashboardMigrator that upgrades old JSON forward when schemaVersion is
 * behind -- CURRENT_SCHEMA_VERSION + migrate() exist from day one here too,
 * even trivial now, since retrofitting migration onto an already-shipped
 * format is the harder path.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export interface GridPos {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface DashboardPanel {
	id: string;
	/** Which fixture/live widget renderer owns this panel -- e.g. "ci", "tickets". */
	type: string;
	title: string;
	gridPos: GridPos;
}

export interface DashboardLayout {
	schemaVersion: number;
	panels: DashboardPanel[];
}

export function emptyDashboard(): DashboardLayout {
	return { schemaVersion: CURRENT_SCHEMA_VERSION, panels: [] };
}

/**
 * Upgrades a persisted (possibly older) layout to the current schema.
 * No prior versions exist yet, so this is an identity migration for v1 --
 * the seam is what matters, not the migration logic itself yet.
 */
export function migrateDashboard(data: unknown): DashboardLayout {
	if (!isRecord(data)) return emptyDashboard();
	const schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;
	const panels = Array.isArray(data.panels) ? data.panels.filter(isDashboardPanel) : [];

	if (schemaVersion > CURRENT_SCHEMA_VERSION) {
		// Newer than we understand -- don't guess, return empty rather than
		// silently misinterpret a future format.
		return emptyDashboard();
	}

	// v0 -> v1: no real shape change yet; this branch is the seam for future
	// migrations (schemaVersion 0 covers any pre-versioning fixture data).
	return { schemaVersion: CURRENT_SCHEMA_VERSION, panels };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isGridPos(value: unknown): value is GridPos {
	if (!isRecord(value)) return false;
	return typeof value.x === "number" && typeof value.y === "number" && typeof value.w === "number" && typeof value.h === "number";
}

function isDashboardPanel(value: unknown): value is DashboardPanel {
	if (!isRecord(value)) return false;
	return typeof value.id === "string" && typeof value.type === "string" && typeof value.title === "string" && isGridPos(value.gridPos);
}
