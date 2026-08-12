import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import "./styles.css";

const container = document.querySelector<HTMLElement>("#app");
if (!container) throw new Error("Alignment root element is missing");

const root = createRoot(container);
root.render(
	<StrictMode>
		<App />
	</StrictMode>,
);

if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
