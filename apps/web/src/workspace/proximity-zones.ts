import type { Position } from "dockview-react";

export interface Rect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** Reuses dockview-react's own Position type -- these are exactly the positions its addPanel/onDidDrop API already accepts, not a parallel vocabulary. */
const EDGE_POSITIONS: readonly Position[] = ["left", "right", "top", "bottom"];
const ALL_GROUP_POSITIONS: readonly Position[] = [...EDGE_POSITIONS, "center"];

/** How much of the whole canvas a root-level edge zone spans from its own edge inward. */
const ROOT_EDGE_FRACTION = 0.25;

export interface DropZone {
	readonly id: string;
	/** Undefined for a root-level (whole-canvas) zone -- it isn't relative to any one existing group. */
	readonly groupId?: string;
	readonly position: Position;
	readonly rect: Rect;
	readonly centroid: Point;
}

function centroidOf(rect: Rect): Point {
	return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function groupPositionRect(rect: Rect, position: Position): Rect {
	switch (position) {
		case "left":
			return { left: rect.left, top: rect.top, width: rect.width / 2, height: rect.height };
		case "right":
			return { left: rect.left + rect.width / 2, top: rect.top, width: rect.width / 2, height: rect.height };
		case "top":
			return { left: rect.left, top: rect.top, width: rect.width, height: rect.height / 2 };
		case "bottom":
			return { left: rect.left, top: rect.top + rect.height / 2, width: rect.width, height: rect.height / 2 };
		default:
			return rect; // "center" -- dock as a tab, occupies the group's whole rect
	}
}

function rootPositionRect(canvasRect: Rect, position: Position): Rect {
	const edgeWidth = canvasRect.width * ROOT_EDGE_FRACTION;
	const edgeHeight = canvasRect.height * ROOT_EDGE_FRACTION;
	switch (position) {
		case "left":
			return { left: canvasRect.left, top: canvasRect.top, width: edgeWidth, height: canvasRect.height };
		case "right":
			return { left: canvasRect.left + canvasRect.width - edgeWidth, top: canvasRect.top, width: edgeWidth, height: canvasRect.height };
		case "top":
			return { left: canvasRect.left, top: canvasRect.top, width: canvasRect.width, height: edgeHeight };
		default:
			return { left: canvasRect.left, top: canvasRect.top + canvasRect.height - edgeHeight, width: canvasRect.width, height: edgeHeight }; // "bottom"
	}
}

/**
 * Every possible drop position across the whole canvas: each existing
 * group's own 5 positions (left/right/top/bottom half-slices + center for
 * "dock as a tab"), plus the 4 root-level whole-canvas edges (a brand-new
 * top-level split, a sibling of every existing group rather than a
 * division inside one). Always the full set regardless of group count --
 * even a single group renders all 9. Deciding which to actually light up
 * is proximity's job, not this function's.
 */
export function computeDropZones(groups: readonly { id: string; rect: Rect }[], canvasRect: Rect): readonly DropZone[] {
	const groupZones = groups.flatMap((group) =>
		ALL_GROUP_POSITIONS.map((position) => {
			const rect = groupPositionRect(group.rect, position);
			return { id: `${group.id}:${position}`, groupId: group.id, position, rect, centroid: centroidOf(rect) };
		}),
	);
	const rootZones = EDGE_POSITIONS.map((position) => {
		const rect = rootPositionRect(canvasRect, position);
		return { id: `root:${position}`, position, rect, centroid: centroidOf(rect) };
	});
	return [...groupZones, ...rootZones];
}

/** Half the canvas's own diagonal -- resolution-independent influence radius, not a fixed pixel constant. */
export function proximityInfluenceRadius(canvasRect: Rect): number {
	return Math.hypot(canvasRect.width, canvasRect.height) / 2;
}

/** Every possible position stays faintly visible for the whole drag -- never fully invisible. */
export const PROXIMITY_FLOOR_OPACITY = 0.06;
/** Brightest a zone's own breathing peak reaches, right at its own centroid. */
export const PROXIMITY_CEILING_OPACITY = 0.85;

/**
 * 0 (at or beyond maxInfluenceRadius from the zone's own centroid) .. 1
 * (right at the centroid). Squared falloff: faint until genuinely close,
 * then ramps up fast, rather than a mushy linear fade.
 */
export function dropZoneCloseness(pointer: Point, zone: DropZone, maxInfluenceRadius: number): number {
	if (maxInfluenceRadius <= 0) return 0;
	const distance = Math.hypot(pointer.x - zone.centroid.x, pointer.y - zone.centroid.y);
	const linear = Math.max(0, 1 - distance / maxInfluenceRadius);
	return linear * linear;
}

/** Maps a 0..1 closeness score into the opacity a zone's own breathing should peak at. */
export function dropZoneOpacity(closeness: number): number {
	return PROXIMITY_FLOOR_OPACITY + (PROXIMITY_CEILING_OPACITY - PROXIMITY_FLOOR_OPACITY) * closeness;
}

/**
 * The Dock Ruler's own live split preview (DockRuler.tsx) is the single
 * confirmed target the pointer is already on, not a proximity-scored
 * candidate -- it breathes brighter than any ambient zone ever does, and
 * never dims to their faint floor. Same shared breathing rhythm, own range.
 */
export const ACTIVE_ZONE_FLOOR_OPACITY = 0.5;
export const ACTIVE_ZONE_CEILING_OPACITY = 1;
