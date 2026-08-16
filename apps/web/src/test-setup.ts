import "@testing-library/jest-dom/vitest";

class TestResizeObserver implements ResizeObserver {
	disconnect(): void {}
	observe(): void {}
	unobserve(): void {}
}

globalThis.ResizeObserver = TestResizeObserver;

// jsdom doesn't implement matchMedia at all -- real xterm.js (TerminalSurface's
// own createXtermUi smoke test) calls it during Terminal.open() to watch for
// a DPI change, and throws outright without this.
function testMediaQueryList(media: string): MediaQueryList {
	return {
		matches: false,
		media,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	};
}

globalThis.matchMedia = testMediaQueryList;

// cmdk (CommandDialog's own Picker) scrolls the newly-selected item into view on
// every highlight change -- jsdom implements no scrolling/layout at all, so
// Element.prototype.scrollIntoView doesn't exist there either. This setup file
// runs for every test in this workspace, including plain-node tests with no DOM
// at all -- `typeof Element` guards against a real ReferenceError there. The
// assignment itself stays unconditional (never "if not already present"): TS's
// own DOM lib types believe scrollIntoView always exists, so that existence
// check is what @typescript-eslint/no-unnecessary-condition actually flags.
if (typeof Element !== "undefined") {
	Element.prototype.scrollIntoView = () => {};
}
