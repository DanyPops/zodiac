import { DockviewComponent, type GroupPanelPartInitParameters, type IContentRenderer } from "dockview";
import type Graph from "graphology";
import { renderConversationView } from "./conversation-view.js";
import { renderObservabilityView } from "./observability-view.js";

class ConversationPanel implements IContentRenderer {
	private readonly _element: HTMLElement;

	constructor(private readonly graph: Graph) {
		this._element = document.createElement("div");
		this._element.className = "h-full";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		renderConversationView(this._element, this.graph);
	}
}

class ObservabilityPanel implements IContentRenderer {
	private readonly _element: HTMLElement;
	private view: { resize(): void; dispose(): void } | undefined;

	constructor(private readonly graph: Graph) {
		this._element = document.createElement("div");
		this._element.className = "h-full";
	}

	get element(): HTMLElement {
		return this._element;
	}

	init(_parameters: GroupPanelPartInitParameters): void {
		this.view = renderObservabilityView(this._element, this.graph);
	}

	// sigma can't measure a hidden container -- if this panel starts inactive
	// (e.g. stacked behind another tab), resize once it actually becomes visible.
	onShow(): void {
		this.view?.resize();
	}

	dispose(): void {
		this.view?.dispose();
	}
}

export interface DockviewApp {
	component: DockviewComponent;
	/** Keeps dockview's own theme class in sync with the app-wide theme controller; call from a theme.subscribe() listener. */
	setDark(isDark: boolean): void;
	dispose(): void;
}

/**
 * Wires a two-panel dockview shell: Conversation (real data, unrefined
 * rendering — see the conversation-tile task) and Observability (placeholder
 * — see the observability-tile task). Panel content is deliberately thin
 * here; this task is only the dockview wiring itself.
 */
export function createDockviewApp(container: HTMLElement, graph: Graph): DockviewApp {
	const component = new DockviewComponent(container, {
		createComponent: (options): IContentRenderer => {
			switch (options.name) {
				case "conversation":
					return new ConversationPanel(graph);
				case "observability":
					return new ObservabilityPanel(graph);
				default:
					throw new Error(`Unknown dockview component: ${options.name}`);
			}
		},
	});

	component.addPanel({ id: "conversation", component: "conversation", title: "Conversation" });
	component.addPanel({
		id: "observability",
		component: "observability",
		title: "Observability",
		position: { referencePanel: "conversation", direction: "right" },
	});

	function setDark(isDark: boolean): void {
		container.classList.toggle("dockview-theme-dark", isDark);
		container.classList.toggle("dockview-theme-light", !isDark);
	}

	return {
		component,
		setDark,
		dispose: () => component.dispose(),
	};
}
