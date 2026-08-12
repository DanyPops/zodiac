/** @vitest-environment jsdom */
import { useEffect } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowDockview } from "./WindowDockview.js";

// Fakes dockview-react only -- real WindowDockview logic runs unmodified.
// Captures the onWillShowOverlay callback it registers so a test can call
// it directly with a synthetic event.
const dockview = vi.hoisted(() => {
	const onWillShowOverlay = vi.fn();
	const api = {
		activePanel: undefined,
		addPanel: vi.fn(),
		getPanel: vi.fn(() => undefined),
		getGroup: vi.fn(() => undefined),
		onWillShowOverlay,
		onUnhandledDragOver: vi.fn(() => ({ dispose() {} })),
		onDidRemovePanel: vi.fn(() => ({ dispose() {} })),
		onDidActivePanelChange: vi.fn(() => ({ dispose() {} })),
	};
	return { api };
});

vi.mock("dockview-react", () => ({
	DockviewReact: (props: { onReady: (event: { api: typeof dockview.api }) => void }) => {
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; onReady is a fresh closure every WindowDockview render, listing it would re-fire this every render instead of once.
		useEffect(() => props.onReady({ api: dockview.api }), []);
		return null;
	},
	DockviewDefaultTab: () => null,
	positionToDirection: (position: string) => position,
	themeAbyssSpaced: {},
	themeLightSpaced: {},
}));

function renderWindowDockview(onDockRulerHintChange: () => void) {
	render(
		<WindowDockview
			windowId="test-window"
			dockedSurfaces={[]}
			onPendingDockConsumed={() => {}}
			onPanelClosed={() => {}}
			onExternalTemplateDrop={() => {}}
			onDockRulerHintChange={onDockRulerHintChange}
			isDark={false}
			conversationItems={[]}
			conversationLoading={false}
			draft=""
			onDraftChange={() => {}}
			onComposerFocus={() => {}}
			onUndockChat={() => {}}
			chatPinned={false}
			onTogglePinChat={() => {}}
			onSaveAsTemplate={() => {}}
		/>,
	);
	return dockview.api.onWillShowOverlay.mock.calls.at(-1)?.[0] as (event: unknown) => void;
}

// Fixed, off-center content box -- never the small center dead-zone, so a hint always resolves once the gate lets one through.
const fakeGroup = { element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) } };

function contentOverlayEvent(clientX: number, clientY = 50) {
	return { kind: "content", group: fakeGroup, nativeEvent: new PointerEvent("pointermove", { clientX, clientY }) };
}

describe("WindowDockview's onWillShowOverlay -- content-kind (an already-docked pane's own Dock Ruler)", () => {
	// jsdom has no DragEvent -- dockRulerHintFromEvent's own `instanceof DragEvent` guard needs it defined. Never actually constructed below.
	vi.stubGlobal("DragEvent", class extends Event {});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("a fast dragover flood is idle-gated, not recomputed on every event -- real, reported degradation introduced with the Dock Ruler", () => {
		const onDockRulerHintChange = vi.fn();
		const onWillShowOverlay = renderWindowDockview(onDockRulerHintChange);

	for (let i = 0; i < 50; i++) onWillShowOverlay(contentOverlayEvent(20 + i));

		// Ungated, this was 1:1 with the input flood.
		expect(onDockRulerHintChange.mock.calls.length).toBeLessThan(5);
	});

	it("still shows a real hint once the pointer settles -- the gate suppresses a fast pass, it doesn't disable the Ruler", () => {
		const onDockRulerHintChange = vi.fn();
		const onWillShowOverlay = renderWindowDockview(onDockRulerHintChange);

		for (let i = 0; i < 50; i++) onWillShowOverlay(contentOverlayEvent(20 + i));
		onDockRulerHintChange.mockClear();

		// Same position as the last sample -- zero distance, zero velocity.
		onWillShowOverlay(contentOverlayEvent(20 + 49));

		expect(onDockRulerHintChange).toHaveBeenCalledTimes(1);
		expect(onDockRulerHintChange).toHaveBeenCalledWith(expect.objectContaining({ axis: "horizontal" }));
	});
});
