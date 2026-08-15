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
