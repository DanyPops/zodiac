import { describe, expect, it } from "vitest";
import { createVisualDnaStyleTarget } from "./visual-dna-style.js";

/** Plain mock, no jsdom -- the target takes its style host as an argument rather than reaching for `document` directly. */
function createHost() {
	const properties = new Map<string, string>();
	return {
		host: { style: { setProperty: (name: string, value: string) => properties.set(name, value) } },
		properties,
	};
}

describe("Visual DNA style target", () => {
	it("applies line width and corner radius as CSS custom properties", () => {
		const { host, properties } = createHost();
		createVisualDnaStyleTarget(host).apply({ vibe: 100, cornerSharpness: 50 });
		expect(properties.get("--app-line-width")).toBe("1px");
		expect(properties.get("--app-corner-radius")).toBe("16px");
	});

	it("re-applies on every call, tracking the latest value", () => {
		const { host, properties } = createHost();
		const target = createVisualDnaStyleTarget(host);
		target.apply({ vibe: 0, cornerSharpness: 0 });
		expect(properties.get("--app-line-width")).toBe("3px");
		expect(properties.get("--app-corner-radius")).toBe("0px");
		target.apply({ vibe: 100, cornerSharpness: 100 });
		expect(properties.get("--app-line-width")).toBe("1px");
		expect(properties.get("--app-corner-radius")).toBe("32px");
	});
});
