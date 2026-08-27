import { execFileSync } from "node:child_process";
import { ModalEditorComponent } from "@danypops/pi-lector/editor";
import { createLectorZodiacContribution } from "@danypops/zodiac-lector";
import { describe, expect, it } from "vitest";

describe("installed Lector packages", () => {
	it("form one valid dependency set", () => {
		expect(() =>
			execFileSync(
				"npm",
				["ls", "@danypops/lector", "@danypops/pi-lector", "@danypops/zodiac-lector"],
				{ cwd: new URL("../../../../", import.meta.url), encoding: "utf8", stdio: "pipe" },
			),
		).not.toThrow();
	});

	it("loads editor and navigation capabilities", () => {
		expect(typeof ModalEditorComponent).toBe("function");

		const commandIds = createLectorZodiacContribution({ operations: { call: async () => ({}) } })
			.describe()
			.commands.map((command) => command.id);
		expect(commandIds).toEqual(
			expect.arrayContaining([
				"lector.file.open",
				"lector.file.save",
				"lector.symbol.hover",
				"lector.symbol.definition",
				"lector.call-graph.prepare",
				"lector.call-graph.incoming",
				"lector.call-graph.outgoing",
				"lector.call-graph.reachable",
			]),
		);
	});
});
