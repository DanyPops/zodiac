/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createRuntimeClientBundle } from "./runtime-client-bundle.js";
import { RuntimeClientBundleProvider, useOptionalRuntimeClientBundle, useRuntimeClientBundle } from "./runtime-client-bundle-context.js";

function ReadsRequiredBundle({ label }: { readonly label: string }): React.JSX.Element {
	const bundle = useRuntimeClientBundle();
	return <div data-testid={label}>{bundle.zodiacdBaseUrl}</div>;
}

function ReadsOptionalBundle({ label }: { readonly label: string }): React.JSX.Element {
	const bundle = useOptionalRuntimeClientBundle();
	return <div data-testid={label}>{bundle ? bundle.zodiacdBaseUrl : "none"}</div>;
}

describe("RuntimeClientBundleProvider", () => {
	it("hands every descendant consumer the exact same bundle instance -- one topology, not one per consumer", () => {
		const bundle = createRuntimeClientBundle("http://127.0.0.1:4390");
		render(
			<RuntimeClientBundleProvider bundle={bundle}>
				<ReadsRequiredBundle label="conversations" />
				<ReadsRequiredBundle label="pi" />
				<ReadsOptionalBundle label="terminal" />
			</RuntimeClientBundleProvider>,
		);
		expect(screen.getByTestId("conversations").textContent).toBe("http://127.0.0.1:4390");
		expect(screen.getByTestId("pi").textContent).toBe("http://127.0.0.1:4390");
		expect(screen.getByTestId("terminal").textContent).toBe("http://127.0.0.1:4390");
	});

	it("useRuntimeClientBundle throws outside a provider -- a programmer error, not a silently-undefined config", () => {
		expect(() => render(<ReadsRequiredBundle label="orphan" />)).toThrow(/RuntimeClientBundleProvider/);
	});

	it("useOptionalRuntimeClientBundle returns undefined outside a provider instead of throwing, for a component with its own override prop", () => {
		render(<ReadsOptionalBundle label="orphan-optional" />);
		expect(screen.getByTestId("orphan-optional").textContent).toBe("none");
	});
});
