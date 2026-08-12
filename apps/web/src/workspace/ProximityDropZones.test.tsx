/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PROXIMITY_FLOOR_OPACITY, type DropZone } from "./proximity-zones.js";
import { ProximityDropZones } from "./ProximityDropZones.js";

afterEach(cleanup);

const zone: DropZone = { id: "g1:left", groupId: "g1", position: "left", rect: { left: 10, top: 20, width: 100, height: 200 }, centroid: { x: 60, y: 120 } };

describe("ProximityDropZones", () => {
	it("never intercepts pointer/drag events -- a pure ambient overlay above the native drag target", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map()} />);
		expect(screen.getByTestId("drop-zone-g1:left")).toHaveClass("pointer-events-none");
	});

	it("positions each zone at its own rect", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map()} />);
		expect(screen.getByTestId("drop-zone-g1:left")).toHaveStyle({ left: "10px", top: "20px", width: "100px", height: "200px" });
	});

	it("falls back to the faint floor as the peak (--zone-max-opacity) when a zone has no computed opacity yet", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map()} />);
		const el = screen.getByTestId("drop-zone-g1:left");
		expect(el.style.getPropertyValue("--zone-max-opacity")).toBe(String(PROXIMITY_FLOOR_OPACITY));
		expect(el.style.getPropertyValue("--zone-min-opacity")).toBe(String(PROXIMITY_FLOOR_OPACITY));
		expect(el.style.opacity).toBe(String(PROXIMITY_FLOOR_OPACITY));
	});

	it("uses the supplied opacity as the breathing peak, and as the static (reduced-motion) fallback opacity", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map([["g1:left", 0.7]])} />);
		const el = screen.getByTestId("drop-zone-g1:left");
		expect(el.style.getPropertyValue("--zone-max-opacity")).toBe("0.7");
		expect(el.style.getPropertyValue("--zone-min-opacity")).toBe(String(PROXIMITY_FLOOR_OPACITY));
		expect(el.style.opacity).toBe("0.7");
	});

	it("plays a slow, smooth, always-on breathing animation, frozen static under prefers-reduced-motion", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map()} />);
		const el = screen.getByTestId("drop-zone-g1:left");
		expect(el).toHaveClass("animate-zone-breathe");
		expect(el).toHaveClass("motion-reduce:animate-none");
	});

	it("stays strictly greyscale -- no accent or hue classes, only the neutral gray scale", () => {
		render(<ProximityDropZones zones={[zone]} zoneOpacities={new Map()} />);
		expect(screen.getByTestId("drop-zone-g1:left").className).not.toMatch(/accent/);
	});

	it("renders one element per zone", () => {
		const other: DropZone = { ...zone, id: "root:top", groupId: undefined, position: "top" };
		render(<ProximityDropZones zones={[zone, other]} zoneOpacities={new Map()} />);
		expect(screen.getByTestId("drop-zone-g1:left")).toBeInTheDocument();
		expect(screen.getByTestId("drop-zone-root:top")).toBeInTheDocument();
	});
});
