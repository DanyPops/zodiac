import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

describe("cn", () => {
	it("joins truthy class fragments with a space", () => {
		expect(cn("a", "b", "c")).toBe("a b c");
	});

	it("drops falsy fragments -- the common conditional-class pattern", () => {
		expect(cn("base", false, null, undefined, "extra")).toBe("base extra");
	});

	it("resolves a conflicting Tailwind utility in favor of the later one", () => {
		expect(cn("bg-white", "bg-black")).toBe("bg-black");
	});
});
