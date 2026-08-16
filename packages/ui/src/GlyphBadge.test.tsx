/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlyphBadge } from "./GlyphBadge.js";
import { glyphBadgeClassName } from "./glyph-badge-style.js";

afterEach(cleanup);

describe("GlyphBadge", () => {
	it("idle: no fill, no border, muted text -- flush against its surface", () => {
		render(<GlyphBadge>3</GlyphBadge>);
		const badge = screen.getByText("3");
		expect(badge.className).not.toMatch(/bg-gray-100|border-gray-300/);
		expect(badge).toHaveClass("text-gray-500");
	});

	it("active: bordered, filled chip with darker content -- one step up the same ladder", () => {
		render(<GlyphBadge active>3</GlyphBadge>);
		const badge = screen.getByText("3");
		expect(badge).toHaveClass("border");
		expect(badge).toHaveClass("border-gray-300");
		expect(badge).toHaveClass("bg-gray-100");
		expect(badge).toHaveClass("text-gray-950");
	});

	it("rings regardless of active state", () => {
		render(<GlyphBadge ring>3</GlyphBadge>);
		expect(screen.getByText("3")).toHaveClass("ring-2", "ring-accent");
	});

	it("sizes map to the three sizes every real call site uses today", () => {
		expect(glyphBadgeClassName({ size: "sm" })).toContain("size-6");
		expect(glyphBadgeClassName({ size: "md" })).toContain("size-7");
		expect(glyphBadgeClassName({ size: "lg" })).toContain("size-9");
	});

	it("merges a caller's own extra className", () => {
		render(<GlyphBadge className="custom-marker">3</GlyphBadge>);
		expect(screen.getByText("3")).toHaveClass("custom-marker");
	});
});
