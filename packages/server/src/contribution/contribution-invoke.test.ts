import { describe, expect, it } from "vitest";
import type { ContributionCommand, ContributionDescription } from "@zodiac/protocol";
import { invokeContributionCommand } from "./contribution-invoke.js";

function fixtureDescription(): ContributionDescription {
	return { id: "lector", title: "Lector", commands: [{ id: "lector.file.save", title: "Save File" }], resourceSchemes: [] };
}

function fixtureRegistry(command: ContributionCommand) {
	return { descriptions: new Map([["lector", fixtureDescription()]]), commands: new Map([[command.id, command]]) };
}

describe("invokeContributionCommand", () => {
	it("returns the command's own outcome for a registered contribution/command", async () => {
		const command: ContributionCommand = { id: "lector.file.save", title: "Save File", execute: async (input) => ({ ok: true, value: { uri: `file://${(input as { path: string }).path}`, kind: "file", title: "a.ts", readOnly: false } }) };

		const result = await invokeContributionCommand("lector", "lector.file.save", { path: "a.ts" }, fixtureRegistry(command));

		expect(result).toEqual({ ok: true, value: { uri: "file://a.ts", kind: "file", title: "a.ts", readOnly: false } });
	});

	it("reports contribution-not-found for an unregistered contributionId", async () => {
		const result = await invokeContributionCommand("ghost", "anything", {}, { descriptions: new Map(), commands: new Map() });
		expect(result).toEqual({ ok: false, code: "contribution-not-found", message: expect.stringContaining("ghost") });
	});

	it("reports command-not-found when the contribution's own description doesn't list the action", async () => {
		const result = await invokeContributionCommand("lector", "lector.file.delete", {}, { descriptions: new Map([["lector", fixtureDescription()]]), commands: new Map() });
		expect(result).toEqual({ ok: false, code: "command-not-found", message: expect.stringContaining("lector.file.delete") });
	});

	it("reports command-unavailable when the description lists it but nothing is currently registered", async () => {
		const result = await invokeContributionCommand("lector", "lector.file.save", {}, { descriptions: new Map([["lector", fixtureDescription()]]), commands: new Map() });
		expect(result).toEqual({ ok: false, code: "command-unavailable", message: expect.stringContaining("lector.file.save") });
	});

	it("wraps a thrown execute() error as a typed contribution-error outcome instead of rejecting", async () => {
		const command: ContributionCommand = { id: "lector.file.save", title: "Save File", execute: async () => { throw new Error("stale hash"); } };

		const result = await invokeContributionCommand("lector", "lector.file.save", {}, fixtureRegistry(command));

		expect(result).toEqual({ ok: false, code: "contribution-error", message: "stale hash" });
	});
});
