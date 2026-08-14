/** @vitest-environment jsdom */
import { useEffect } from "react";
import type { Position } from "dockview-react";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
		groups: [] as { id: string; element: { getBoundingClientRect: () => DOMRect } }[],
		addPanel: vi.fn(),
		getPanel: vi.fn(() => undefined),
		getGroup: vi.fn(() => undefined),
		onWillShowOverlay,
		onUnhandledDragOver: vi.fn(() => ({ dispose() {} })),
		onDidRemovePanel: vi.fn(() => ({ dispose() {} })),
		onDidActivePanelChange: vi.fn(() => ({ dispose() {} })),
	};
	return { api, lastOnDidDrop: undefined as ((event: unknown) => void) | undefined, propsHistory: [] as { onDidDrop: unknown; watermarkComponent: unknown }[] };
});

vi.mock("dockview-react", () => ({
	DockviewReact: (props: { onReady: (event: { api: typeof dockview.api }) => void; onDidDrop: (event: unknown) => void; watermarkComponent: unknown }) => {
		dockview.lastOnDidDrop = props.onDidDrop;
		dockview.propsHistory.push({ onDidDrop: props.onDidDrop, watermarkComponent: props.watermarkComponent });
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

function windowDockviewElement(dragActive: boolean, onDockRulerHintChange: () => void, onExternalTemplateDrop: RenderOverrides["onExternalTemplateDrop"] = () => {}) {
	return (
		<WindowDockview
			windowId="test-window"
			dockedSurfaces={[]}
			onPendingDockConsumed={() => {}}
			onPanelClosed={() => {}}
			onExternalTemplateDrop={onExternalTemplateDrop}
			onDockRulerHintChange={onDockRulerHintChange}
			dragActive={dragActive}
			isDark={false}
			conversationItems={[]}
			conversationLoading={false}
			draft=""
			onDraftChange={() => {}}
			onComposerFocus={() => {}}
			chatPlacement="right"
			onSaveAsTemplate={() => {}}
		/>
	);
}

function renderWindowDockview({ onDockRulerHintChange = () => {}, onExternalTemplateDrop = () => {}, dragActive = false }: RenderOverrides & { dragActive?: boolean } = {}) {
	const { container, rerender: rtlRerender } = render(windowDockviewElement(dragActive, onDockRulerHintChange, onExternalTemplateDrop));
	return {
		onWillShowOverlay: dockview.api.onWillShowOverlay.mock.calls.at(-1)?.[0] as (event: unknown) => void,
		onDidDrop: dockview.lastOnDidDrop!,
		wrapper: container.querySelector('[data-testid="window-dockview-wrapper"]') as HTMLElement,
		// Re-renders the *same* onDockRulerHintChange/onExternalTemplateDrop references -- a fresh `() => {}` per call would itself churn any effect that depends on them.
		rerenderWithDragActive: (nextDragActive: boolean) => rtlRerender(windowDockviewElement(nextDragActive, onDockRulerHintChange, onExternalTemplateDrop)),
	};
}

// jsdom has no DragEvent -- dockRulerHintFromEvent's own `instanceof DragEvent` guard needs it defined. Never actually constructed as a real DragEvent below.
class FakeDragEvent extends Event {}

// Fixed, off-center content box -- never the small center dead-zone, so a hint always resolves once the gate lets one through.
const fakeGroup = { id: "group-1", element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) } };

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
		const { onWillShowOverlay, onDidDrop } = renderWindowDockview({ onExternalTemplateDrop });
		// A real drop is always preceded by dragover events for the same group --
		// this is what actually marks the group as "currently a content hover" (see
		// the header-drop regression test below for why that distinction matters).
		// Twice: the idle-velocity gate reads the very first sample as infinitely
		// fast (nothing to compare against yet), same as every other test here.
		onWillShowOverlay(contentOverlayEvent(20));
		onWillShowOverlay(contentOverlayEvent(20));

		onDidDrop(dropEvent("activity", { group: { id: "group-1", element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect } }, clientX: 20, clientY: 50 }));

		expect(onExternalTemplateDrop).toHaveBeenCalledWith("activity", "left", "group-1", expect.any(Number));
	});

	it("real fix for a reported bug: a drop reported with a group but never preceded by a content-kind hover for it (a header/tab-strip drop) defers entirely to dockview's own reported position instead of recomputing a split -- tabs are only reachable by dragging onto a group's own header, never its content", () => {
		const onExternalTemplateDrop = vi.fn();
		const { onDidDrop } = renderWindowDockview({ onExternalTemplateDrop });
		// No onWillShowOverlay(contentOverlayEvent(...)) call first -- this group
		// was never marked as a content hover (onWillShowOverlay's own kind would
		// have been 'tab'/'header_space' for a real header drop, never 'content').

		onDidDrop(dropEvent("activity", { group: { id: "group-1", element: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) as DOMRect } }, position: "right", clientX: 20, clientY: 50 }));

		// dockview's own reported position ("right" here, but for a real header
		// drop it reports the tab-insert position) wins, with no computed ratio --
		// not the "left" a naive coordinate recompute against this exact clientX/Y
		// would produce (see the test above, same coordinates, different outcome).
		expect(onExternalTemplateDrop).toHaveBeenCalledWith("activity", "right", "group-1", undefined);
	});
});

// The ambient "every possible drop position" layer -- distinct from the
// content-kind Dock Ruler above (that one only appears once the pointer is
// already inside one specific group's content). Driven by a plain native
// dragover listener on the wrapper, not onWillShowOverlay -- see
// WindowDockview.tsx's own comment on why it needs its own idle-velocity ref.
describe("WindowDockview's ambient proximity drop zones", () => {
	vi.stubGlobal("DragEvent", FakeDragEvent);

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		dockview.api.groups = [];
		dockview.propsHistory = [];
	});

	function dragOverAt(clientX: number, clientY = 200): DragEvent {
		const event = new DragEvent("dragover") as DragEvent & { clientX: number; clientY: number };
		event.clientX = clientX;
		event.clientY = clientY;
		return event;
	}

	// Raw wrapper.dispatchEvent bypasses React Testing Library's act() wrapping
	// -- React 18 batches the resulting setState calls without a synchronous
	// flush, so the DOM wouldn't reflect it yet. fireEvent's generic form wraps
	// in act() the same as its named helpers (fireEvent.dragOver isn't one of
	// them, and wouldn't accept our stubbed FakeDragEvent instance anyway).
	function dispatch(wrapper: HTMLElement, event: DragEvent): void {
		fireEvent(wrapper, event);
	}

	function rect(left: number, top: number, width: number, height: number): DOMRect {
		return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
	}

	it("renders nothing while no drag is active -- dragActive=false is the default", () => {
		const { wrapper } = renderWindowDockview();
		dispatch(wrapper, dragOverAt(20));
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]')).toHaveLength(0);
	});

	it("a fast dragover flood is idle-gated -- the very same regression class as the content-kind Ruler, for the same reason", () => {
		const { wrapper } = renderWindowDockview({ dragActive: true });
		for (let i = 0; i < 50; i++) dispatch(wrapper, dragOverAt(20 + i));
		// Every sample lands at a different X at effectively the same instant --
		// each reads as fast, so none should have populated the zones yet.
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]')).toHaveLength(0);
	});

	it("shows all 4 root zones with zero docked groups -- every possible position, even with nothing docked yet", () => {
		const { wrapper } = renderWindowDockview({ dragActive: true });
		dispatch(wrapper, dragOverAt(20));
		// Settle: same position twice in a row reads as zero velocity.
		dispatch(wrapper, dragOverAt(20));
		for (const position of ["left", "right", "top", "bottom"]) expect(wrapper.querySelector(`[data-testid="drop-zone-root:${position}"]`)).not.toBeNull();
	});

	it("adds 5 more zones per existing docked group", () => {
		dockview.api.groups = [{ id: "group-1", element: { getBoundingClientRect: () => rect(0, 0, 400, 200) } }];
		const { wrapper } = renderWindowDockview({ dragActive: true });
		// Outside the group's own rect entirely -- computeDockRulerHint no longer
		// has a dead-zone (a real fix: dragging to a group's own exact center now
		// always splits, see dock-ruler.test.ts), so hovering anywhere *inside* a
		// group now always suppresses exactly one of its 5 positions in favor of
		// the Ruler's own live highlight -- this checks the other 4 root zones'
		// own math, unaffected since no group is actually being hovered here.
		dispatch(wrapper, dragOverAt(500, 300));
		dispatch(wrapper, dragOverAt(500, 300));
		for (const position of ["left", "right", "top", "bottom", "center"]) expect(wrapper.querySelector(`[data-testid="drop-zone-group-1:${position}"]`)).not.toBeNull();
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]')).toHaveLength(5 + 4);
	});

	it("real regression: onDidDrop and watermarkComponent must keep a stable identity across the re-renders this layer causes -- dockview-react rebuilds its own watermark DOM node whenever watermarkComponent's reference changes, which corrupted a real native browser drag mid-gesture (a real mouse drop onto the empty watermark silently stopped docking anything)", () => {
		const { wrapper } = renderWindowDockview({ dragActive: true });
		dispatch(wrapper, dragOverAt(20));
		dispatch(wrapper, dragOverAt(20)); // idle -- triggers a real setState/re-render
		dispatch(wrapper, dragOverAt(40)); // a second, different sample -- another re-render
		dispatch(wrapper, dragOverAt(40));

		expect(dockview.propsHistory.length).toBeGreaterThan(1); // sanity: re-renders actually happened
		const identities = new Set(dockview.propsHistory.map((props) => props.onDidDrop));
		expect(identities.size).toBe(1);
		const watermarkIdentities = new Set(dockview.propsHistory.map((props) => props.watermarkComponent));
		expect(watermarkIdentities.size).toBe(1);
	});

	it("the closer zone breathes brighter than a far one -- proximity actually drives brightness, not just presence", () => {
		dockview.api.groups = [{ id: "group-1", element: { getBoundingClientRect: () => rect(0, 0, 800, 400) } }];
		const { wrapper } = renderWindowDockview({ dragActive: true });
		// jsdom never performs real layout -- getBoundingClientRect defaults to
		// all-zero, which would zero out proximityInfluenceRadius too.
		vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rect(0, 0, 800, 400));
		// Off-center toward the top-left -- the Ruler itself favors "top" here
		// (suppressing group-1:top, see the regression test above), leaving
		// left/right both still ambient: left, closer to the pointer's own x, should read brighter.
		dispatch(wrapper, dragOverAt(200, 50));
		dispatch(wrapper, dragOverAt(200, 50));
		const leftPeak = Number.parseFloat((wrapper.querySelector('[data-testid="drop-zone-group-1:left"]') as HTMLElement).style.getPropertyValue("--zone-max-opacity"));
		const rightPeak = Number.parseFloat((wrapper.querySelector('[data-testid="drop-zone-group-1:right"]') as HTMLElement).style.getPropertyValue("--zone-max-opacity"));
		expect(leftPeak).toBeGreaterThan(rightPeak);
	});

	it("real regression: suppresses the one ambient zone matching the Dock Ruler's own currently-favored position, so the two visual systems can never disagree about the same spot", () => {
		dockview.api.groups = [{ id: "group-1", element: { getBoundingClientRect: () => rect(0, 0, 800, 400) } }];
		const { wrapper } = renderWindowDockview({ dragActive: true });
		// Near the left edge -- the Ruler would favor "left" for this exact group.
		dispatch(wrapper, dragOverAt(10, 200));
		dispatch(wrapper, dragOverAt(10, 200));

		expect(wrapper.querySelector('[data-testid="drop-zone-group-1:left"]')).toBeNull();
		expect(wrapper.querySelector('[data-testid="drop-zone-group-1:right"]')).not.toBeNull();
		expect(wrapper.querySelector('[data-testid="drop-zone-group-1:center"]')).not.toBeNull();
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]')).toHaveLength(5 + 4 - 1);
	});

	it("real regression: dockview's own root-edge classification overrides our own geometry guess -- a group close enough to the canvas's own edge that dockview reclassifies a content hover as a root split no longer lights up its own small per-group zone, and the matching root zone gets promoted to the confirmed-target brightness instead of a mere proximity guess", () => {
		dockview.api.groups = [{ id: "group-1", element: { getBoundingClientRect: () => rect(0, 300, 800, 100) } }];
		const { wrapper, onWillShowOverlay } = renderWindowDockview({ dragActive: true });
		vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(rect(0, 0, 800, 400));

		// dockview's own real hit-testing decided this exact position is a
		// root-level edge (no group of its own), not a content split inside
		// group-1 -- exactly what happens for a group thin enough, or close
		// enough to the canvas's own edge, in a real browser.
		onWillShowOverlay({ kind: "edge", group: undefined, position: "bottom", nativeEvent: new PointerEvent("pointermove"), preventDefault: () => {} });

		// The raw pointer still geometrically sits inside group-1's own rect.
		dispatch(wrapper, dragOverAt(400, 380));
		dispatch(wrapper, dragOverAt(400, 380));

		expect(wrapper.querySelector('[data-testid="drop-zone-group-1:bottom"]')).toBeNull();
		expect(wrapper.querySelector('[data-testid="drop-zone-group-1:top"]')).not.toBeNull();
		const rootBottom = wrapper.querySelector('[data-testid="drop-zone-root:bottom"]') as HTMLElement;
		expect(rootBottom).not.toBeNull();
		expect(Number.parseFloat(rootBottom.style.getPropertyValue("--zone-max-opacity"))).toBe(1);
	});

	it("clears once the drag ends by any means -- dragActive flipping false, matching the Ruler's own cleanup", () => {
		const { wrapper, rerenderWithDragActive } = renderWindowDockview({ dragActive: true });
		dispatch(wrapper, dragOverAt(20));
		dispatch(wrapper, dragOverAt(20));
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]').length).toBeGreaterThan(0);

		rerenderWithDragActive(false);
		expect(wrapper.querySelectorAll('[data-testid^="drop-zone-"]')).toHaveLength(0);
	});
});
