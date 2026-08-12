/** @vitest-environment jsdom */
import { useEffect } from "react";
import type { Position } from "dockview-react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_DRAG_MIME_TYPE } from "./drag-constants.js";
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
	return { api, lastOnDidDrop: undefined as ((event: unknown) => void) | undefined };
});

vi.mock("dockview-react", () => ({
	DockviewReact: (props: { onReady: (event: { api: typeof dockview.api }) => void; onDidDrop: (event: unknown) => void }) => {
		dockview.lastOnDidDrop = props.onDidDrop;
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; onReady is a fresh closure every WindowDockview render, listing it would re-fire this every render instead of once.
		useEffect(() => props.onReady({ api: dockview.api }), []);
		return null;
	},
	DockviewDefaultTab: () => null,
	positionToDirection: (position: string) => position,
	themeAbyssSpaced: {},
	themeLightSpaced: {},
}));

interface RenderOverrides {
	onDockRulerHintChange?: () => void;
	onExternalTemplateDrop?: (templateId: string, position: Position, referenceGroupId: string | undefined, newGroupSizeRatio: number | undefined) => void;
}

function renderWindowDockview({ onDockRulerHintChange = () => {}, onExternalTemplateDrop = () => {} }: RenderOverrides = {}) {
	render(
		<WindowDockview
			windowId="test-window"
			dockedSurfaces={[]}
			onPendingDockConsumed={() => {}}
			onPanelClosed={() => {}}
			onExternalTemplateDrop={onExternalTemplateDrop}
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
	return {
		onWillShowOverlay: dockview.api.onWillShowOverlay.mock.calls.at(-1)?.[0] as (event: unknown) => void,
		onDidDrop: dockview.lastOnDidDrop!,
	};
}

// jsdom has no DragEvent -- dockRulerHintFromEvent's own `instanceof DragEvent` guard needs it defined. Never actually constructed as a real DragEvent below.
class FakeDragEvent extends Event {}

// Fixed, off-center content box -- never the small center dead-zone, so a hint always resolves once the gate lets one through.
const fakeGroup = { element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) } };

function contentOverlayEvent(clientX: number, clientY = 50) {
	return { kind: "content", group: fakeGroup, nativeEvent: new PointerEvent("pointermove", { clientX, clientY }) };
}

describe("WindowDockview's onWillShowOverlay -- content-kind (an already-docked pane's own Dock Ruler)", () => {
	vi.stubGlobal("DragEvent", FakeDragEvent);

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("a fast dragover flood is idle-gated, not recomputed on every event -- real, reported degradation introduced with the Dock Ruler", () => {
		const onDockRulerHintChange = vi.fn();
		const { onWillShowOverlay } = renderWindowDockview({ onDockRulerHintChange });

		for (let i = 0; i < 50; i++) onWillShowOverlay(contentOverlayEvent(20 + i));

		// Ungated, this was 1:1 with the input flood.
		expect(onDockRulerHintChange.mock.calls.length).toBeLessThan(5);
	});

	it("still shows a real hint once the pointer settles -- the gate suppresses a fast pass, it doesn't disable the Ruler", () => {
		const onDockRulerHintChange = vi.fn();
		const { onWillShowOverlay } = renderWindowDockview({ onDockRulerHintChange });

		for (let i = 0; i < 50; i++) onWillShowOverlay(contentOverlayEvent(20 + i));
		onDockRulerHintChange.mockClear();

		// Same position as the last sample -- zero distance, zero velocity.
		onWillShowOverlay(contentOverlayEvent(20 + 49));

		expect(onDockRulerHintChange).toHaveBeenCalledTimes(1);
		expect(onDockRulerHintChange).toHaveBeenCalledWith(expect.objectContaining({ axis: "horizontal" }));
	});
});

// Directly tests the reported "first dock works, the rest don't" bug: does
// onDidDrop still call onExternalTemplateDrop for a drop onto an existing
// group (kind the empty-Window watermark never sees), independent of
// whatever onWillShowOverlay's own preview gating is doing.
describe("WindowDockview's onDidDrop", () => {
	vi.stubGlobal("DragEvent", FakeDragEvent);

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	function dropEvent(templateId: string, extra: { position?: Position; group?: { id: string; element: { getBoundingClientRect: () => DOMRect } }; clientX?: number; clientY?: number } = {}) {
		const nativeEvent = new DragEvent("drop") as DragEvent & { dataTransfer: DataTransfer; clientX: number; clientY: number };
		nativeEvent.dataTransfer = { getData: (type: string) => (type === TEMPLATE_DRAG_MIME_TYPE ? templateId : "") } as unknown as DataTransfer;
		nativeEvent.clientX = extra.clientX ?? 0;
		nativeEvent.clientY = extra.clientY ?? 0;
		return { nativeEvent, position: extra.position ?? "right", group: extra.group };
	}

	it("a drop with no reference group (the empty-Window watermark) docks via dockview's own reported position", () => {
		const onExternalTemplateDrop = vi.fn();
		const { onDidDrop } = renderWindowDockview({ onExternalTemplateDrop });

		onDidDrop(dropEvent("activity", { position: "right" }));

		expect(onExternalTemplateDrop).toHaveBeenCalledWith("activity", "right", undefined, undefined);
	});

	it("a drop onto an existing group's content -- the second dock, not the first -- still docks, sized from the recomputed hint", () => {
		const onExternalTemplateDrop = vi.fn();
		const { onDidDrop } = renderWindowDockview({ onExternalTemplateDrop });

		onDidDrop(dropEvent("activity", { group: { id: "group-1", element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect } }, clientX: 20, clientY: 50 }));

		expect(onExternalTemplateDrop).toHaveBeenCalledWith("activity", "left", "group-1", expect.any(Number));
	});
});
