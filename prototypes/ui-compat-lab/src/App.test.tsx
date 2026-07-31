import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./PersesTimeSeries", () => ({
  PersesTimeSeries: () => <div data-testid="perses-chart">Perses chart mounted</div>,
}));

describe("compatibility lab", () => {
  it("keeps AI conversation and Perses visualization in independent surface boundaries", () => {
    render(<App />);

    expect(screen.getByRole("log", { name: "AI conversation" })).toBeInTheDocument();
    expect(screen.getByTestId("perses-chart")).toBeInTheDocument();
    expect(screen.getByText("Unsupported peer range")).toBeInTheDocument();
    expect(screen.getAllByText("PASS")).toHaveLength(1);
    expect(screen.getAllByText("FAIL")).toHaveLength(1);
  });
});
