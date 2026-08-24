/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VehicleSurfaceClient } from "./client.js";
import { JittorUsageMeter } from "./JittorUsageMeter.js";

const NOW = 1_700_000_000_000;

function usageSeriesRow(metric: string, sum: number, bucketIndex = 0): { scope: string; metric: string; bucketIndex: number; sum: number } {
	return { scope: "anthropic:claude", metric, bucketIndex, sum };
}

function clientFixture(rows: readonly ReturnType<typeof usageSeriesRow>[]) {
	const invoke = vi.fn(async (surfaceId: string, request: { name: string; input: unknown }) => {
		if (surfaceId !== "jittor" || request.name !== "metrics.usage_series") throw new Error(`unexpected invoke: ${surfaceId}/${request.name}`);
		return { ok: true as const, output: { rows, truncated: false } };
	});
	const client: VehicleSurfaceClient = { manifest: vi.fn(), invoke, subscribe: vi.fn(() => ({ close: vi.fn() })) };
	return { client, invoke };
}

afterEach(cleanup);

describe("JittorUsageMeter", () => {
	it("renders recent token count and cost, sourced through the generic Vehicle Surface Gateway (jittor), never a bespoke token endpoint", async () => {
		const fixture = clientFixture([usageSeriesRow("output-tokens", 1_234), usageSeriesRow("cost", 0.42)]);
		render(<JittorUsageMeter client={fixture.client} now={() => NOW} />);
		await screen.findByText(/1\.2K tok/);
		expect(screen.getByText(/\$0\.42/)).toBeInTheDocument();
		expect(fixture.invoke).toHaveBeenCalledWith("jittor", expect.objectContaining({ name: "metrics.usage_series", version: 1, input: expect.objectContaining({ source: "pi" }) }));
	});

	it("renders nothing while the first poll is still pending, then a real value once it resolves -- no placeholder flash", async () => {
		const fixture = clientFixture([usageSeriesRow("output-tokens", 10)]);
		const { container } = render(<JittorUsageMeter client={fixture.client} now={() => NOW} />);
		expect(container.textContent).toBe("");
		await screen.findByText(/10 tok/);
	});

	it("shows an explicit unavailable state, never a silent blank, when the Jittor Vehicle Surface itself is unreachable", async () => {
		const client: VehicleSurfaceClient = { manifest: vi.fn(), invoke: vi.fn(async () => ({ ok: false as const, error: { code: "vehicle-surface-unavailable", category: "unavailable" as const, message: "Jittor is not running", retryable: true } })), subscribe: vi.fn(() => ({ close: vi.fn() })) };
		render(<JittorUsageMeter client={client} now={() => NOW} />);
		await screen.findByText("usage: unavailable");
	});

	it("shows a real zero-usage state distinctly from the unavailable state", async () => {
		const fixture = clientFixture([]);
		render(<JittorUsageMeter client={fixture.client} now={() => NOW} />);
		await screen.findByText("no recent usage");
	});

	it("never renders a bearer token or the Jittor daemon's own base URL -- only the aggregated totals", async () => {
		const fixture = clientFixture([usageSeriesRow("input-tokens", 999)]);
		const { container } = render(<JittorUsageMeter client={fixture.client} now={() => NOW} />);
		await waitFor(() => expect(container.textContent).not.toBe(""));
		expect(container.textContent).not.toMatch(/bearer|token|authorization|http:\/\//i);
	});
});
