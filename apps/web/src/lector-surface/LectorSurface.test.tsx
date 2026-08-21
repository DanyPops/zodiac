/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContributionClient } from "./client.js";
import { LectorSurfaceContent } from "./LectorSurface.js";

const workspace = { uri: "lector://workspace/ws?path=", kind: "workspace", title: "repo", readOnly: true } as const;
const file = { uri: "lector://text/ws?path=src%2Findex.ts", kind: "text", title: "index.ts", readOnly: true } as const;

function fixture(): ContributionClient {
	const client: ContributionClient = {
		list: vi.fn(async () => [{ id: "lector", title: "Lector", commands: [{ id: "lector.workspace.open", title: "Open Workspace" }, { id: "lector.file.open", title: "Open File" }], resourceSchemes: ["lector"], contributionPoints: ["editor" as const] }]),
		invoke: vi.fn(async (_id, commandId) => ({ ok: true as const, value: commandId === "lector.workspace.open" ? workspace : file })),
		read: vi.fn(async (_id, resource) => resource.kind === "workspace"
			? { ok: true as const, value: { kind: "tree", path: "", entries: [{ name: "index.ts", kind: "file", resource: file }] } }
			: { ok: true as const, value: { kind: "text", path: "src/index.ts", content: "export const answer = 42;", bytes: 25, readOnly: true } }),
	};
	return client;
}

afterEach(cleanup);

describe("LectorSurfaceContent", () => {
	it("opens a real bounded workspace tree and reads selected source without an empty placeholder", async () => {
		const client = fixture();
		render(<LectorSurfaceContent client={client} />);
		fireEvent.change(screen.getByLabelText("Workspace path"), { target: { value: "/repo" } });
		const open = await screen.findByRole("button", { name: "Open" });
		fireEvent.click(open);
		fireEvent.click(await screen.findByRole("button", { name: /index\.ts/ }));
		expect(await screen.findByText("export const answer = 42;")).toBeTruthy();
		expect(client.invoke).toHaveBeenCalledWith("lector", "lector.workspace.open", { path: "/repo" });
		expect(client.read).toHaveBeenCalled();
	});

	it("fails visibly when the package-owned contribution is not configured", async () => {
		const client = fixture();
		client.list = vi.fn(async () => []);
		render(<LectorSurfaceContent client={client} />);
		expect(await screen.findByText(/Lector is not configured/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
	});
});
