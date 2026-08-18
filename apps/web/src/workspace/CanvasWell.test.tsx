/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { CanvasWell } from "./CanvasWell.js";

afterEach(cleanup);

function approvalRequest(overrides: Partial<VehicleApprovalRequest> = {}): VehicleApprovalRequest {
	return {
		requestId: "REQ-1",
		operationName: "issue.create",
		operationVersion: 1,
		effect: "external-write",
		requestedAt: Date.now(),
		expiresAt: Date.now() + 5 * 60_000,
		inputHash: "deadbeef",
		...overrides,
	};
}

describe("CanvasWell", () => {
	it("always renders Notifications and the clock, flush inside its own header strip", () => {
		render(
			<CanvasWell>
				<p>content</p>
			</CanvasWell>,
		);
		expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
		expect(screen.getByRole("status", { name: "Current time" })).toBeInTheDocument();
	});

	it("renders its content below the header strip, inside the same well -- not a second independent box", () => {
		render(
			<CanvasWell>
				<p>the real content</p>
			</CanvasWell>,
		);
		const content = screen.getByText("the real content");
		const notifications = screen.getByRole("button", { name: "Notifications" });
		// Both trace back to the same outer well box -- one shared ancestor, not two siblings at the App level.
		expect(content.closest("[data-canvas-well]")).toBe(notifications.closest("[data-canvas-well]"));
	});

	it("renders an optional center slot (the Window Carousel) between Notifications and the clock, only when given one", () => {
		const { rerender } = render(
			<CanvasWell>
				<p>content</p>
			</CanvasWell>,
		);
		expect(screen.queryByTestId("canvas-well-center")).not.toBeInTheDocument();

		rerender(
			<CanvasWell center={<nav aria-label="Window Carousel" />}>
				<p>content</p>
			</CanvasWell>,
		);
		expect(screen.getByRole("navigation", { name: "Window Carousel" })).toBeInTheDocument();
	});

	it("top-aligns the header row's own children, not center -- the Carousel's pill-plus-caption stack is taller than a bare pill, and centering would misalign Notifications/the clock against the Carousel's own pill", () => {
		const { container } = render(
			<CanvasWell center={<nav aria-label="Window Carousel" />}>
				<p>content</p>
			</CanvasWell>,
		);
		const header = container.querySelector("[data-canvas-well] > div") as HTMLElement;
		expect(header.className).toContain("items-start");
		expect(header.className).not.toContain("items-center");
	});

	it("threads pendingApprovals/onApproveRequest/onDenyRequest straight through to NotificationsPill", () => {
		const onApproveRequest = vi.fn();
		const onDenyRequest = vi.fn();
		render(
			<CanvasWell pendingApprovals={[approvalRequest()]} onApproveRequest={onApproveRequest} onDenyRequest={onDenyRequest}>
				<p>content</p>
			</CanvasWell>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
		expect(screen.getByText(/issue\.create/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onApproveRequest).toHaveBeenCalledExactlyOnceWith("REQ-1");
		fireEvent.click(screen.getByRole("button", { name: "Deny" }));
		expect(onDenyRequest).toHaveBeenCalledExactlyOnceWith("REQ-1");
	});

	it("is flush to its own column's top edge -- no separate header row sits above it (WELL_BG covers the whole box, header included)", () => {
		render(
			<CanvasWell>
				<p>content</p>
			</CanvasWell>,
		);
		const well = screen.getByTestId("canvas-well");
		expect(well.className).toMatch(/bg-gray-100|dark:bg-well-dark/);
		expect(well.className).toMatch(/rounded-\[var\(--app-corner-radius/);
	});
});
