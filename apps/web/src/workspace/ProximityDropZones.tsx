import type { CSSProperties } from "react";
import { PROXIMITY_FLOOR_OPACITY, type DropZone } from "./proximity-zones.js";

interface ProximityDropZonesProps {
	/** Every possible drop position for the current drag -- see computeDropZones. */
	readonly zones: readonly DropZone[];
	/** This frame's own breathing peak (dropZoneOpacity's output) per zone id -- a zone missing here breathes only up to the shared faint floor. */
	readonly zoneOpacities: ReadonlyMap<string, number>;
}

/**
 * Ambient, always-visible guidance for every possible drop position during a
 * drag -- distinct from DockRuler, which only appears once the pointer is
 * already inside one specific group's content. Every zone breathes between
 * the same faint floor and its own proximity-driven peak: cold zones barely
 * rise, hot ones swing bright. Greyscale only, no per-zone hue -- brightness
 * alone carries the hot/cold signal.
 */
export function ProximityDropZones({ zones, zoneOpacities }: ProximityDropZonesProps): React.JSX.Element {
	return (
		<>
			{zones.map((zone) => {
				const peakOpacity = zoneOpacities.get(zone.id) ?? PROXIMITY_FLOOR_OPACITY;
				const style: CSSProperties & Record<string, string | number> = {
					left: zone.rect.left,
					top: zone.rect.top,
					width: zone.rect.width,
					height: zone.rect.height,
					opacity: peakOpacity, // static fallback while motion-reduce:animate-none disables the animation below
					"--zone-min-opacity": PROXIMITY_FLOOR_OPACITY,
					"--zone-max-opacity": peakOpacity,
				};
				return (
					<div key={zone.id} data-testid={`drop-zone-${zone.id}`} className="pointer-events-none absolute animate-zone-breathe border border-gray-500 motion-reduce:animate-none dark:border-gray-400" style={style}>
						<span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-500 dark:bg-gray-400" />
					</div>
				);
			})}
		</>
	);
}
