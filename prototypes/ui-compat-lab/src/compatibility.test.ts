import { describe, expect, it } from "vitest";
import { assessCompatibility } from "./compatibility";

describe("assessCompatibility", () => {
  it("reports React 19 as supported by AI Elements but outside Perses' peer range", () => {
    expect(
      assessCompatibility({
        hostReact: "19.2.3",
        aiElementsReact: "^19.0.0",
        persesReact: "^17.0.2 || ^18.0.0",
      }),
    ).toEqual({
      aiElementsSupported: true,
      persesSupported: false,
      packageCompatible: false,
      verdict: "unsupported-peer-range",
    });
  });

  it("reports React 18 as supported by Perses but outside AI Elements' target", () => {
    expect(
      assessCompatibility({
        hostReact: "18.3.1",
        aiElementsReact: "^19.0.0",
        persesReact: "^17.0.2 || ^18.0.0",
      }),
    ).toMatchObject({
      aiElementsSupported: false,
      persesSupported: true,
      packageCompatible: false,
    });
  });
});
