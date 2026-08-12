import { describe, expect, it } from "vitest";
import { ContributionReadBoundsSchema, ContributionResourceReferenceSchema, type ZodiacContribution, type ContributionHost } from "./contributions.js";

describe("package contribution contract", () => {
  it("bounds framework-neutral resource references and reads", () => {
    expect(ContributionResourceReferenceSchema.safeParse({ uri: "lector-workspace://abc/", kind: "workspace", title: "abc", readOnly: true }).success).toBe(true);
    expect(ContributionResourceReferenceSchema.safeParse({ uri: "x".repeat(2_049), kind: "workspace", title: "abc", readOnly: true }).success).toBe(false);
    expect(ContributionReadBoundsSchema.safeParse({ maxBytes: 4 * 1024 * 1024, maxEntries: 10_000 }).success).toBe(true);
    expect(ContributionReadBoundsSchema.safeParse({ maxBytes: 4 * 1024 * 1024 + 1, maxEntries: 10_001 }).success).toBe(false);
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
});
