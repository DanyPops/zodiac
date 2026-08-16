export type { Constraint, SurfaceTile, TileChild, TileFailure, TileFailureReason, TileResult, TileDuplicateSurface, TileSurfaceNotFound, TileTooManyChildren, TileTooManySurfaces, TileTooDeep } from "./tile.js";
export { insertTile, removeTile, tileDepth, MAX_TILE_DEPTH, MAX_CHILDREN_PER_TILE, MAX_SURFACES_PER_TILE } from "./tile.js";

export type { Rect, SurfacePlacement, GeometryFailure, GeometryInvalidArea, GeometryInsufficientArea, GeometryTooManyPlacements, GeometryResult } from "./geometry.js";
export { computeTileRects, MAX_PLACEMENTS } from "./geometry.js";
