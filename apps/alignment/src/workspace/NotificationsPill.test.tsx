/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationsPill } from "./NotificationsPill.js";

afterEach(cleanup);

describe("NotificationsPill", () => {
	it("starts closed", () => {
		render(<NotificationsPill />);
		expect(screen.queryByText("No notifications yet.")).not.toBeInTheDocument();
	});

	it("opens on click, showing the empty state", () => {
		render(<NotificationsPill />);
		fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
		expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
	});

	it("uses the shared utility-pill shape and surface fill, the same elements the Carousel and WatchPill use", () => {
		render(<NotificationsPill />);
		const pill = screen.getByRole("button", { name: "Notifications" }).parentElement!;
		expect(pill).toHaveClass("h-10", "rounded-[var(--app-corner-radius,16px)]");
		expect(pill.className).toMatch(/bg-white/);
	});

	it("the trigger follows Corner Sharpness like every other Icon Button, not a fixed rounded-md", () => {
		render(<NotificationsPill />);
		const trigger = screen.getByRole("button", { name: "Notifications" });
		expect(trigger.className).toContain("rounded-[var(--app-corner-radius");
		expect(trigger.className).not.toMatch(/(?<!:)rounded-md/);
	});
});
