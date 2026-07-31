import { satisfies } from "semver";

export interface CompatibilityInput {
  hostReact: string;
  aiElementsReact: string;
  persesReact: string;
}

export interface CompatibilityAssessment {
  aiElementsSupported: boolean;
  persesSupported: boolean;
  packageCompatible: boolean;
  verdict: "supported" | "unsupported-peer-range";
}

export function assessCompatibility(input: CompatibilityInput): CompatibilityAssessment {
  const aiElementsSupported = satisfies(input.hostReact, input.aiElementsReact);
  const persesSupported = satisfies(input.hostReact, input.persesReact);
  const packageCompatible = aiElementsSupported && persesSupported;

  return {
    aiElementsSupported,
    persesSupported,
    packageCompatible,
    verdict: packageCompatible ? "supported" : "unsupported-peer-range",
  };
}
