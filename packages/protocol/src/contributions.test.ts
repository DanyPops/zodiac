import { describe, expect, it } from "vitest";
import {
  APPLET_CONTRIBUTION_POINT,
  ContributionCardinalitySchema,
  ContributionDescriptionSchema,
  ContributionInvokeRequestSchema,
  ContributionPointDefinitionSchema,
  ContributionProvenanceSchema,
  ContributionReadBoundsSchema,
  ContributionResourceReadRequestSchema,
  ContributionResourceReferenceSchema,
  EDITOR_CONTRIBUTION_POINT,
  VEHICLE_LOOPBACK_CONTRIBUTION_POINT,
  VEHICLE_SURFACE_CONTRIBUTION_POINT,
  type ZodiacContribution,
  type ContributionHost,
} from "./contributions.js";

describe("package contribution contract", () => {
  it("defines bounded applet/editor points, generic cardinality, and package provenance", () => {
    expect(APPLET_CONTRIBUTION_POINT).toEqual({ kind: "applet", cardinality: "zero-or-many" });
    expect(EDITOR_CONTRIBUTION_POINT).toEqual({ kind: "editor", cardinality: "exactly-one" });
    expect(VEHICLE_SURFACE_CONTRIBUTION_POINT).toEqual({ kind: "vehicle-surface", cardinality: "zero-or-many" });
    expect(VEHICLE_LOOPBACK_CONTRIBUTION_POINT).toEqual({ kind: "vehicle-loopback", cardinality: "zero-or-many" });
    expect(ContributionCardinalitySchema.options).toEqual(["exactly-one", "zero-or-one", "zero-or-many"]);
    expect(ContributionPointDefinitionSchema.safeParse(EDITOR_CONTRIBUTION_POINT).success).toBe(true);
    expect(ContributionPointDefinitionSchema.safeParse({ kind: "unknown", cardinality: "many" }).success).toBe(false);
    expect(ContributionProvenanceSchema.parse({ packageId: "@danypops/zodiac-lector", version: "1.2.3", source: "npm:@danypops/zodiac-lector@1.2.3" })).toEqual({
      packageId: "@danypops/zodiac-lector",
      version: "1.2.3",
      source: "npm:@danypops/zodiac-lector@1.2.3",
    });
    expect(ContributionProvenanceSchema.safeParse({ packageId: "", version: "1", source: "x" }).success).toBe(false);
  });

  it("bounds framework-neutral resource references and reads", () => {
    expect(ContributionResourceReferenceSchema.safeParse({ uri: "lector-workspace://abc/", kind: "workspace", title: "abc", readOnly: true }).success).toBe(true);
    expect(ContributionResourceReferenceSchema.safeParse({ uri: "x".repeat(2_049), kind: "workspace", title: "abc", readOnly: true }).success).toBe(false);
    expect(ContributionReadBoundsSchema.safeParse({ maxBytes: 4 * 1024 * 1024, maxEntries: 10_000 }).success).toBe(true);
    expect(ContributionReadBoundsSchema.safeParse({ maxBytes: 4 * 1024 * 1024 + 1, maxEntries: 10_001 }).success).toBe(false);
  });

  it("bounds contribution HTTP catalog, invoke, and resource-read contracts", () => {
    expect(ContributionDescriptionSchema.safeParse({ id: "lector", title: "Lector", commands: [{ id: "lector.workspace.open", title: "Open Workspace" }], resourceSchemes: ["lector"], contributionPoints: ["editor"] }).success).toBe(true);
    expect(ContributionInvokeRequestSchema.safeParse({ commandId: "lector.workspace.open", input: { path: "/repo" } }).success).toBe(true);
    expect(ContributionResourceReadRequestSchema.safeParse({ resource: { uri: "lector://workspace/ws?path=", kind: "workspace", title: "repo", readOnly: true }, bounds: { maxBytes: 1024, maxEntries: 100 } }).success).toBe(true);
    expect(ContributionInvokeRequestSchema.safeParse({ commandId: "x".repeat(201) }).success).toBe(false);
  });

  it("supports describe, activate registration, and disposal without a renderer dependency", async () => {
    const registrations: string[] = [];
    const host: ContributionHost = {
      registerCommand: command => { registrations.push(command.id); return () => registrations.splice(registrations.indexOf(command.id), 1); },
      registerResourceProvider: provider => { registrations.push(provider.scheme); return () => registrations.splice(registrations.indexOf(provider.scheme), 1); },
    };
    const contribution: ZodiacContribution = {
      describe: () => ({ id: "example", title: "Example", commands: [], resourceSchemes: [] }),
      activate: () => { host.registerCommand({ id: "example.open", title: "Open", execute: async () => ({ ok: false, code: "not-ready", message: "Not ready" }) }); },
      dispose: () => { registrations.length = 0; },
    };
    expect(contribution.describe().id).toBe("example");
    await contribution.activate(host);
    expect(registrations).toEqual(["example.open"]);
    await contribution.dispose();
    expect(registrations).toEqual([]);
  });

  it("version and capabilities are optional -- a contribution written before either field existed still typechecks and parses unchanged", () => {
    const legacy: ZodiacContribution["describe"] = () => ({ id: "example", title: "Example", commands: [], resourceSchemes: [] });
    const described = legacy();
    expect(described.version).toBeUndefined();
    expect(described.capabilities).toBeUndefined();
  });

  it("a contribution may declare its own version and capability tags", () => {
    const described: ReturnType<ZodiacContribution["describe"]> = { id: "example", title: "Example", commands: [], resourceSchemes: [], version: "1.2.0", capabilities: ["streaming-resources"], contributionPoints: ["editor"] };
    expect(described.version).toBe("1.2.0");
    expect(described.contributionPoints).toEqual(["editor"]);
    expect(described.capabilities).toEqual(["streaming-resources"]);
  });
});
