/** @vitest-environment jsdom */
import type { VehicleApprovalRequest } from "@danypops/vehicle-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsPill } from "./NotificationsPill.js";

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

describe("NotificationsPill", () => {
	it("starts closed", () => {
		render(<NotificationsPill />);
		expect(screen.queryByText("No notifications yet.")).not.toBeInTheDocument();
	});

	it("opens on click, showing the empty state when there are no pending requests", () => {
		render(<NotificationsPill />);
		fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
		expect(screen.getByText("No notifications yet.")).toBeInTheDocument();
	});

	it("renders a pending VehicleApprovalRequest with its operation and effect, and working Approve/Deny actions", () => {
		const onApprove = vi.fn();
		const onDeny = vi.fn();
		render(<NotificationsPill pending={[approvalRequest()]} onApprove={onApprove} onDeny={onDeny} />);
		fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

		expect(screen.queryByText("No notifications yet.")).not.toBeInTheDocument();
		expect(screen.getByText(/issue\.create/)).toBeInTheDocument();
		expect(screen.getByText(/external-write/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		expect(onApprove).toHaveBeenCalledExactlyOnceWith("REQ-1");
		expect(onDeny).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Deny" }));
		expect(onDeny).toHaveBeenCalledExactlyOnceWith("REQ-1");
	});

	it("renders one row per pending request, each with its own scoped Approve/Deny actions", () => {
		const onApprove = vi.fn();
		render(
			<NotificationsPill
				pending={[approvalRequest({ requestId: "REQ-1", operationName: "issue.create" }), approvalRequest({ requestId: "REQ-2", operationName: "issue.merge" })]}
				onApprove={onApprove}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

		const approveButtons = screen.getAllByRole("button", { name: "Approve" });
		expect(approveButtons).toHaveLength(2);

		fireEvent.click(approveButtons[1]!);
		expect(onApprove).toHaveBeenCalledExactlyOnceWith("REQ-2");
	});

	it("the trigger badges the pending count so it's visible without opening the popover, and shows nothing when there is none", () => {
		const { rerender } = render(<NotificationsPill pending={[]} />);
		expect(screen.queryByText("2")).not.toBeInTheDocument();

		rerender(<NotificationsPill pending={[approvalRequest({ requestId: "REQ-1" }), approvalRequest({ requestId: "REQ-2" })]} />);
		expect(screen.getByText("2")).toBeInTheDocument();
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
