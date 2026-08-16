import "@testing-library/jest-dom/vitest";

// cmdk (Picker's internals) observes its own list element's size to drive the
// --cmdk-list-height CSS variable, and scrolls the newly-selected item into
// view on every highlight change -- jsdom has neither ResizeObserver nor any
// scrolling/layout at all. This setup file runs for every test in this
// workspace, including plain-node tests (e.g. pill-style.test.ts) with no DOM
// at all -- `typeof Element` guards against a real ReferenceError there.
if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
}
if (typeof Element !== "undefined") {
	Element.prototype.scrollIntoView = () => {};
}
