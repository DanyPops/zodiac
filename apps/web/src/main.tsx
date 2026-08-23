import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { RuntimeClientBundleProvider } from "./platform/runtime-client-bundle-context.js";
import { createRuntimeClientBundle } from "./platform/runtime-client-bundle.js";
import { resolveZodiacdBaseUrl } from "./platform/zodiacd-config.js";
import "./styles.css";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("Zodiac root element is missing");

// The Web entry is the one place `import.meta.env` and the runtime client
// bundle are constructed -- a future apps/desktop entry builds the same
// RuntimeClientBundle from its own DesktopHostPort-resolved base URL
// instead, with zero change to App.tsx or anything it renders.
const bundle = createRuntimeClientBundle(resolveZodiacdBaseUrl());

const root = createRoot(container);
root.render(
	<StrictMode>
		<RuntimeClientBundleProvider bundle={bundle}>
			<App />
		</RuntimeClientBundleProvider>
	</StrictMode>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
