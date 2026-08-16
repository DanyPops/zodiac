/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UserAvatar } from "./UserAvatar.js";

afterEach(() => {
	cleanup();
});

describe("UserAvatar", () => {
	it("defaults to Libra when no sign is given -- no real per-user profile exists yet", () => {
		render(<UserAvatar />);
		expect(screen.getByRole("img", { name: "Libra (you)" })).toBeInTheDocument();
	});

	it("renders a real, distinct <svg> glyph for the resolved sign", () => {
		render(<UserAvatar />);
		expect(screen.getByRole("img", { name: "Libra (you)" }).querySelector("svg")).not.toBeNull();
	});

	it("is always a true circle (rounded-full), not the shared --app-corner-radius token every other shape follows", () => {
		render(<UserAvatar />);
		const avatar = screen.getByRole("img", { name: "Libra (you)" });
		expect(avatar).toHaveClass("rounded-full");
		expect(avatar.className).not.toMatch(/--app-corner-radius/);
	});

	it("falls back to Libra for an id that doesn't name a known sign, rather than rendering nothing", () => {
		render(<UserAvatar sign={"not-a-real-sign" as never} />);
		expect(screen.getByRole("img", { name: "Libra (you)" })).toBeInTheDocument();
	});

	it("resolves a different real sign when one is given", () => {
		render(<UserAvatar sign="leo" />);
		expect(screen.getByRole("img", { name: "Leo (you)" })).toBeInTheDocument();
	});
});
