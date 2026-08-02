/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchPill } from "./WatchPill.js";

beforeEach(() => vi.useFakeTimers().setSystemTime(new Date(2024, 0, 1, 9, 5)));
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("WatchPill", () => {
	it("is a passive status region, not a button -- there's no action to take on the current time", () => {
		render(<WatchPill />);
		expect(screen.getByRole("status", { name: "Current time" })).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows the current time as HH:MM", () => {
		render(<WatchPill />);
		expect(screen.getByText("09:05")).toBeInTheDocument();
	});

	it("uses the shared utility-pill shape and surface fill, the same elements the Carousel and Notifications use", () => {
		render(<WatchPill />);
		const pill = screen.getByRole("status", { name: "Current time" });
		expect(pill).toHaveClass("h-10", "rounded-[var(--app-corner-radius,16px)]");
		expect(pill.className).toMatch(/bg-white/);
	});

	it("keeps ticking as real time passes, without a remount", () => {
		render(<WatchPill />);
		act(() => vi.advanceTimersByTime(60_000));
		expect(screen.getByText("09:06")).toBeInTheDocument();
	});
});
